-- ShiftSync core schema.
-- Every table is owned per user and protected by row level security. The API
-- talks to Supabase with each user's own access token, so these policies are
-- the final ownership check. Timestamps are stored in UTC (timestamptz); the
-- IANA time zone used for scheduling rules is kept alongside.

-- ---------------------------------------------------------------- helpers

create or replace function public.shiftsync_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.shiftsync_bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version = old.version + 1;
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------------ users

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text check (email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  display_name text not null default '' check (char_length(display_name) <= 120),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  preferences_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferences_json) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists users_touch on public.users;
create trigger users_touch before update on public.users
  for each row execute function public.shiftsync_touch();

-- A profile row for every new account.
create or replace function public.shiftsync_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists shiftsync_on_auth_user_created on auth.users;
create trigger shiftsync_on_auth_user_created
  after insert on auth.users
  for each row execute function public.shiftsync_handle_new_user();

-- ----------------------------------------------------------------- events

create table if not exists public.events (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  kind text not null default 'event'
    check (kind in ('event', 'shift', 'task', 'unavailable')),
  category text not null
    check (category in ('work', 'class', 'study', 'personal', 'important', 'other')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null check (char_length(timezone) between 1 and 64),
  is_fixed boolean not null,
  priority smallint not null default 2 check (priority between 1 and 3),
  deadline_at timestamptz,
  is_splittable boolean not null default false,
  minimum_block_minutes integer not null default 30
    check (minimum_block_minutes between 5 and 480),
  recurrence text not null default 'never'
    check (recurrence in ('never', 'daily', 'weekly')),
  exception_dates date[] not null default '{}',
  completed boolean not null default false,
  completed_dates date[] not null default '{}',
  status text not null default 'confirmed'
    check (status in ('confirmed', 'open', 'cancelled')),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 16384),
  google_event_id text check (char_length(google_event_id) <= 1024),
  google_calendar_id text check (char_length(google_calendar_id) <= 1024),
  google_etag text,
  google_synced_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_time_order check (end_at > start_at),
  constraint events_max_length check (end_at - start_at <= interval '24 hours')
);

create index if not exists events_user_start on public.events (user_id, start_at);
-- The same commitment cannot be stored twice.
create unique index if not exists events_no_duplicates
  on public.events (user_id, kind, lower(btrim(title)), start_at, end_at, recurrence)
  where status <> 'cancelled';
-- A Google Calendar event maps to exactly one ShiftSync event.
create unique index if not exists events_google_link
  on public.events (user_id, google_calendar_id, google_event_id)
  where google_event_id is not null;

drop trigger if exists events_version on public.events;
create trigger events_version before update on public.events
  for each row execute function public.shiftsync_bump_version();

-- --------------------------------------------------------------- contacts

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text not null check (
    char_length(email) <= 254
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  role text not null check (role in ('work', 'school', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists contacts_unique_email
  on public.contacts (user_id, lower(email));

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before update on public.contacts
  for each row execute function public.shiftsync_touch();

create table if not exists public.event_contacts (
  event_id uuid not null references public.events (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (event_id, contact_id)
);

create index if not exists event_contacts_contact on public.event_contacts (contact_id);

-- -------------------------------------------------------------- conflicts

create table if not exists public.conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conflict_key text not null check (char_length(conflict_key) <= 200),
  event_a_id uuid references public.events (id) on delete set null,
  event_b_id uuid references public.events (id) on delete set null,
  occurrence_date date not null,
  conflict_type text not null check (conflict_type in ('overlap', 'buffer', 'availability')),
  pair_type text check (pair_type in ('fixed_fixed', 'fixed_flexible', 'flexible_flexible')),
  status text not null default 'unresolved' check (
    status in ('unresolved', 'draft_prepared', 'user_contacted', 'resolved', 'dismissed')
  ),
  detected_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  unique (user_id, conflict_key)
);

-- ------------------------------------------------------------ suggestions

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conflict_id uuid references public.conflicts (id) on delete set null,
  event_id uuid not null references public.events (id) on delete cascade,
  occurrence_date date not null,
  event_version integer not null,
  kind text not null check (kind in ('move', 'split')),
  proposed_blocks_json jsonb not null check (jsonb_typeof(proposed_blocks_json) = 'array'),
  score numeric(5, 4) not null check (score between 0 and 1),
  rank smallint not null check (rank between 1 and 3),
  explanation text not null check (char_length(explanation) <= 2000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'stale', 'superseded')),
  result_json jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists suggestions_event on public.suggestions (user_id, event_id, status);

-- ---------------------------------------------------------- notifications

-- One row per prepared email. Status is tracked per message; a draft is
-- never reported as sent.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conflict_id uuid references public.conflicts (id) on delete set null,
  conflict_key text not null check (char_length(conflict_key) <= 200),
  contact_id uuid references public.contacts (id) on delete set null,
  recipient_email text not null check (
    char_length(recipient_email) <= 254
    and recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  recipient_name text not null check (char_length(recipient_name) <= 120),
  recipient_role text not null check (recipient_role in ('work', 'school', 'other')),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 10000),
  source text not null check (source in ('ai', 'template', 'user')),
  status text not null default 'prepared'
    check (status in ('prepared', 'draft_saved', 'sending', 'sent', 'failed')),
  gmail_draft_id text,
  gmail_message_id text,
  error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_sent_has_message
    check (status <> 'sent' or (gmail_message_id is not null and sent_at is not null))
);

create index if not exists notifications_conflict on public.notifications (user_id, conflict_key);

drop trigger if exists notifications_touch on public.notifications;
create trigger notifications_touch before update on public.notifications
  for each row execute function public.shiftsync_touch();

-- ------------------------------------------------- Google OAuth connection

-- Tokens are encrypted by the API (AES-256-GCM) before they are stored.
create table if not exists public.google_connections (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  google_email text,
  scopes text[] not null default '{}',
  refresh_token_enc text not null,
  access_token_enc text,
  access_token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'needs_reauth')),
  calendar_last_sync_at timestamptz,
  calendar_last_sync_error text check (char_length(calendar_last_sync_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists google_connections_touch on public.google_connections;
create trigger google_connections_touch before update on public.google_connections
  for each row execute function public.shiftsync_touch();

-- ------------------------------------------------------------ idempotency

create table if not exists public.idempotency_keys (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scope text not null check (char_length(scope) <= 64),
  key text not null check (char_length(key) between 8 and 128),
  state text not null default 'pending' check (state in ('pending', 'done')),
  status_code integer,
  response_json jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, scope, key)
);

-- ---------------------------------------------------- row level security

alter table public.users enable row level security;
alter table public.events enable row level security;
alter table public.contacts enable row level security;
alter table public.event_contacts enable row level security;
alter table public.conflicts enable row level security;
alter table public.suggestions enable row level security;
alter table public.notifications enable row level security;
alter table public.google_connections enable row level security;
alter table public.idempotency_keys enable row level security;

drop policy if exists users_own on public.users;
create policy users_own on public.users for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'events', 'contacts', 'conflicts', 'suggestions',
    'notifications', 'google_connections', 'idempotency_keys'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t || '_own', t
    );
  end loop;
end;
$$;

-- Links are only allowed between an event and a contact the user owns.
drop policy if exists event_contacts_own on public.event_contacts;
create policy event_contacts_own on public.event_contacts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.events e
                where e.id = event_id and e.user_id = (select auth.uid()))
    and exists (select 1 from public.contacts c
                where c.id = contact_id and c.user_id = (select auth.uid()))
  );

-- Only signed-in users reach these tables, and only through RLS.
revoke all on public.users, public.events, public.contacts, public.event_contacts,
  public.conflicts, public.suggestions, public.notifications,
  public.google_connections, public.idempotency_keys from anon;
grant select, insert, update, delete on public.users, public.events, public.contacts,
  public.event_contacts, public.conflicts, public.suggestions, public.notifications,
  public.google_connections, public.idempotency_keys to authenticated;

-- ------------------------------------------------ atomic recovery approval

-- Applies an approved recovery in one transaction: checks the event has not
-- changed since the suggestion was made, marks the suggestion approved,
-- updates or inserts the event rows, and supersedes sibling suggestions.
create or replace function public.shiftsync_apply_recovery(
  p_suggestion_id uuid,
  p_event_id uuid,
  p_expected_version integer,
  p_updates jsonb,
  p_inserts jsonb
)
returns setof public.events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_updated uuid[];
  v_created uuid[];
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  perform 1 from public.events
    where id = p_event_id and user_id = v_uid and version = p_expected_version
    for update;
  if not found then
    raise exception 'STALE_SUGGESTION' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(u.id), '{}') into v_updated
    from jsonb_to_recordset(p_updates) as u(id uuid);
  select coalesce(array_agg(i.id), '{}') into v_created
    from jsonb_to_recordset(p_inserts) as i(id uuid);

  update public.suggestions
    set status = 'approved',
        decided_at = now(),
        result_json = jsonb_build_object(
          'updated', to_jsonb(v_updated), 'created', to_jsonb(v_created))
    where id = p_suggestion_id and user_id = v_uid and status = 'pending'
      and event_id = p_event_id;
  if not found then
    raise exception 'STALE_SUGGESTION' using errcode = 'P0001';
  end if;

  update public.events e set
    title = u.title,
    start_at = u.start_at,
    end_at = u.end_at,
    exception_dates = coalesce(u.exception_dates, e.exception_dates)
  from jsonb_to_recordset(p_updates) as u(
    id uuid, title text, start_at timestamptz, end_at timestamptz, exception_dates date[]
  )
  where e.id = u.id and e.user_id = v_uid;

  insert into public.events (
    id, user_id, title, kind, category, start_at, end_at, timezone, is_fixed,
    priority, deadline_at, is_splittable, minimum_block_minutes, status, details
  )
  select i.id, v_uid, i.title, i.kind, i.category, i.start_at, i.end_at, i.timezone,
    i.is_fixed, i.priority, i.deadline_at, i.is_splittable, i.minimum_block_minutes,
    i.status, coalesce(i.details, '{}'::jsonb)
  from jsonb_to_recordset(p_inserts) as i(
    id uuid, title text, kind text, category text, start_at timestamptz,
    end_at timestamptz, timezone text, is_fixed boolean, priority smallint,
    deadline_at timestamptz, is_splittable boolean, minimum_block_minutes integer,
    status text, details jsonb
  );

  -- New blocks keep the contacts of the event they came from.
  insert into public.event_contacts (event_id, contact_id, user_id)
  select new_id, ec.contact_id, v_uid
  from unnest(v_created) as new_id
  join public.event_contacts ec on ec.event_id = p_event_id and ec.user_id = v_uid
  on conflict do nothing;

  update public.suggestions
    set status = 'superseded', decided_at = now()
    where user_id = v_uid and event_id = p_event_id and status = 'pending';

  return query
    select * from public.events
    where user_id = v_uid and id = any (v_updated || v_created);
end;
$$;

revoke all on function public.shiftsync_apply_recovery(uuid, uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.shiftsync_apply_recovery(uuid, uuid, integer, jsonb, jsonb) to authenticated;
