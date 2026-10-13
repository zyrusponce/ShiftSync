// Runs the real Supabase migration in an embedded Postgres (PGlite) with a
// minimal stand-in for Supabase's auth schema, then checks RLS and the
// recovery function as two different signed-in users.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";
const COPY = "44444444-4444-4444-8444-444444444444";
let db: PGlite;

const SUPABASE_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  grant usage on schema auth to anon, authenticated;
`;
async function as(user: string | null, run: () => Promise<unknown>) {
  if (user)
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`,
    );
  try {
    return await run();
  } finally {
    await db.exec(
      `reset role; select set_config('request.jwt.claim.sub', '', false);`,
    );
  }
}
const rows = async (sql: string, params: unknown[] = []) =>
  (await db.query<Record<string, unknown>>(sql, params)).rows;
const event = (id: string, title: string, start: string, end: string) =>
  rows(
    `insert into public.events (id, title, kind, category, start_at, end_at, timezone, is_fixed, is_splittable, minimum_block_minutes)
     values ($1, $2, 'event', 'study', $3, $4, 'Asia/Manila', false, true, 60) returning *`,
    [id, title, start, end],
  );

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assert.ok(files.length > 0);
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    await db.exec(sql);
    // Migrations must be safe to run twice.
    await db.exec(sql);
  }
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@example.com', '{"display_name":"Ana"}'), ($2, 'b@example.com', '{}')`,
    [A, B],
  );
});

test("signing up creates a profile row", async () => {
  const users = await rows(
    `select id, email, display_name from public.users order by email`,
  );
  assert.deepEqual(
    users.map((u) => [u.email, u.display_name]),
    [
      ["a@example.com", "Ana"],
      ["b@example.com", ""],
    ],
  );
});

test("15. users cannot read or change another user's schedule", async () => {
  await as(A, () =>
    event(EVENT, "Exam review", "2026-10-13T02:00:00Z", "2026-10-13T04:00:00Z"),
  );
  const own = (await as(A, () =>
    rows(`select id from public.events`),
  )) as unknown[];
  assert.equal(own.length, 1);
  const other = (await as(B, () =>
    rows(`select id from public.events`),
  )) as unknown[];
  assert.equal(other.length, 0);
  const changed = (await as(B, () =>
    rows(
      `update public.events set title = 'Hacked' where id = $1 returning id`,
      [EVENT],
    ),
  )) as unknown[];
  assert.equal(changed.length, 0);
  await assert.rejects(
    as(B, () =>
      rows(
        `insert into public.events (id, user_id, title, category, start_at, end_at, timezone, is_fixed)
         values (gen_random_uuid(), $1, 'Spoof', 'other', now(), now() + interval '1 hour', 'UTC', false)`,
        [A],
      ),
    ),
    /row-level security/,
  );
  await assert.rejects(
    as(null, async () => {
      await db.exec(`set role anon`);
      await rows(`select * from public.events`);
    }),
    /permission denied/,
  );
});

test("constraints reject invalid times, duplicates and unsafe statuses", async () => {
  await assert.rejects(
    as(A, () =>
      event(
        "55555555-5555-4555-8555-555555555555",
        "Backwards",
        "2026-10-13T04:00:00Z",
        "2026-10-13T02:00:00Z",
      ),
    ),
    /events_time_order/,
  );
  await assert.rejects(
    as(A, () =>
      event(
        "66666666-6666-4666-8666-666666666666",
        "exam review ",
        "2026-10-13T02:00:00Z",
        "2026-10-13T04:00:00Z",
      ),
    ),
    /events_no_duplicates/,
  );
  await assert.rejects(
    as(A, () =>
      rows(
        `insert into public.notifications (conflict_key, recipient_email, recipient_name, recipient_role, subject, body, source, status)
         values ('k', 'prof@example.com', 'Prof', 'school', 'Hi', 'Body', 'ai', 'sent')`,
      ),
    ),
    /notifications_sent_has_message/,
  );
  await assert.rejects(
    as(A, () =>
      rows(
        `insert into public.contacts (name, email, role) values ('X', 'not-an-email', 'work')`,
      ),
    ),
    /check constraint/,
  );
});

test("event contacts can only link records the user owns", async () => {
  const [contact] = (await as(A, () =>
    rows(
      `insert into public.contacts (name, email, role) values ('Prof. Reyes', 'prof@example.com', 'school') returning id`,
    ),
  )) as { id: string }[];
  await as(A, () =>
    rows(
      `insert into public.event_contacts (event_id, contact_id) values ($1, $2)`,
      [EVENT, contact.id],
    ),
  );
  await assert.rejects(
    as(B, () =>
      rows(
        `insert into public.event_contacts (event_id, contact_id) values ($1, $2)`,
        [EVENT, contact.id],
      ),
    ),
    /row-level security/,
  );
});

test("16. recovery approval is atomic and cannot be applied twice", async () => {
  const [suggestion] = (await as(A, () =>
    rows(
      `insert into public.suggestions (event_id, occurrence_date, event_version, kind, proposed_blocks_json, score, rank, explanation)
       values ($1, '2026-10-13', 1, 'split', '[]', 0.8, 1, 'Two blocks') returning id`,
      [EVENT],
    ),
  )) as { id: string }[];
  const [sibling] = (await as(A, () =>
    rows(
      `insert into public.suggestions (event_id, occurrence_date, event_version, kind, proposed_blocks_json, score, rank, explanation)
       values ($1, '2026-10-13', 1, 'move', '[]', 0.5, 2, 'Later') returning id`,
      [EVENT],
    ),
  )) as { id: string }[];
  const apply = (user: string) =>
    as(user, () =>
      rows(
        `select * from public.shiftsync_apply_recovery($1, $2, 1, $3::jsonb, $4::jsonb)`,
        [
          suggestion.id,
          EVENT,
          JSON.stringify([
            {
              id: EVENT,
              title: "Exam review (part 1 of 2)",
              start_at: "2026-10-12T23:00:00Z",
              end_at: "2026-10-13T00:00:00Z",
              exception_dates: null,
            },
          ]),
          JSON.stringify([
            {
              id: COPY,
              title: "Exam review (part 2 of 2)",
              kind: "event",
              category: "study",
              start_at: "2026-10-13T10:00:00Z",
              end_at: "2026-10-13T11:00:00Z",
              timezone: "Asia/Manila",
              is_fixed: false,
              priority: 3,
              deadline_at: null,
              is_splittable: true,
              minimum_block_minutes: 60,
              status: "confirmed",
              details: {},
            },
          ]),
        ],
      ),
    );
  await assert.rejects(apply(B), /STALE_SUGGESTION/);
  const result = (await apply(A)) as Record<string, unknown>[];
  assert.equal(result.length, 2);
  const updated = result.find((r) => r.id === EVENT)!;
  assert.equal(updated.version, 2);
  assert.equal(updated.title, "Exam review (part 1 of 2)");
  const statuses = await rows(
    `select id, status, result_json from public.suggestions order by rank`,
  );
  assert.equal(statuses[0].status, "approved");
  assert.deepEqual(statuses[0].result_json, {
    updated: [EVENT],
    created: [COPY],
  });
  assert.equal(statuses.find((s) => s.id === sibling.id)!.status, "superseded");
  const links = await rows(
    `select event_id from public.event_contacts order by event_id`,
  );
  assert.deepEqual(
    links.map((l) => l.event_id),
    [EVENT, COPY],
  );
  // A retried approval finds the suggestion already used and changes nothing.
  await assert.rejects(apply(A), /STALE_SUGGESTION/);
  assert.equal(
    (await rows(`select count(*)::int as n from public.events`))[0].n,
    2,
  );
});

test("Google sign-ups get their Google name on the profile", async () => {
  const C = "55555555-5555-4555-8555-555555555551";
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'c@example.com', '{"full_name":"Gina Student","name":"Gina"}')`,
    [C],
  );
  const [profile] = await rows(
    `select display_name from public.users where id = $1`,
    [C],
  );
  assert.equal(profile.display_name, "Gina Student");
});
