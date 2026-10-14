// Rate limiting and response headers. These run on their own server, so a
// deliberate burst here can never throttle the other test files.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { AppError, rateLimit } from "../src/http";
import { startHarness, type Harness } from "./harness";

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(() => h.close());

/** Runs the limiter on a fake request; resolves to the error it raised, if any. */
function hit(
  limiter: ReturnType<typeof rateLimit>,
  who: { userId?: string; ip?: string },
  path = "/login",
) {
  let failure: unknown = null;
  const req = {
    baseUrl: "/api/auth",
    path,
    route: { path },
    ip: who.ip ?? "203.0.113.1",
    ctx: who.userId ? { user: { id: who.userId } } : undefined,
  } as unknown as Request;
  limiter(
    req,
    {} as Response,
    ((error?: unknown) => {
      failure = error ?? null;
    }) as NextFunction,
  );
  return failure;
}
const limited = (failure: unknown) =>
  failure instanceof AppError && failure.code === "RATE_LIMITED";

test("the limiter allows the limit, refuses the next, and resets after the window", () => {
  let clock = 1_000_000;
  const limiter = rateLimit(3, 60_000, () => clock);
  for (let n = 0; n < 3; n++) assert.equal(hit(limiter, { ip: "a" }), null);
  assert.ok(limited(hit(limiter, { ip: "a" })), "the 4th request is refused");
  clock += 59_999;
  assert.ok(
    limited(hit(limiter, { ip: "a" })),
    "still refused inside the window",
  );
  clock += 1;
  assert.equal(hit(limiter, { ip: "a" }), null, "a new window starts fresh");
});

test("limits are counted per user, per address and per route", () => {
  const limiter = rateLimit(1, 60_000, () => 0);
  assert.equal(hit(limiter, { userId: "u1" }), null);
  assert.ok(limited(hit(limiter, { userId: "u1" })));
  // Another user, another address, or another route each have their own count.
  assert.equal(hit(limiter, { userId: "u2" }), null);
  assert.equal(hit(limiter, { ip: "198.51.100.7" }), null);
  assert.equal(hit(limiter, { userId: "u1" }, "/refresh"), null);
});

test("a burst of logins is refused with 429 once over 10 a minute", async () => {
  const statuses: number[] = [];
  for (let n = 0; n < 12; n++) {
    const response = await fetch(`${h.base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "a@example.com",
        password: "wrong-pass-1",
      }),
    });
    statuses.push(response.status);
    if (response.status === 429) {
      const body = (await response.json()) as { error: { code: string } };
      assert.equal(body.error.code, "RATE_LIMITED");
    }
  }
  assert.ok(statuses.slice(0, 10).every((status) => status !== 429));
  assert.deepEqual(statuses.slice(10), [429, 429]);
});

test("one user hitting the AI limit doesn't throttle anyone else", async () => {
  const busy = h.user("busy@example.com");
  const other = h.user("other@example.com");
  const explain = (user: typeof busy) =>
    user.call("POST", "/api/ai/explain", {
      conflictId: "2026-10-13:x:overlap",
    });
  const statuses: number[] = [];
  for (let n = 0; n < 21; n++) statuses.push((await explain(busy)).status);
  assert.equal(statuses.at(-1), 429, "the 21st call in a minute is refused");
  assert.notEqual((await explain(other)).status, 429);
});

test("every response carries the security headers", async () => {
  for (const path of ["/health", "/api/events", "/privacy", "/nope"]) {
    const response = await fetch(`${h.base}${path}`);
    const header = (name: string) => response.headers.get(name);
    assert.equal(header("x-content-type-options"), "nosniff", path);
    assert.equal(header("x-frame-options"), "DENY", path);
    assert.equal(header("referrer-policy"), "no-referrer", path);
    assert.match(
      header("strict-transport-security") ?? "",
      /max-age=\d+/,
      path,
    );
    assert.match(
      header("content-security-policy") ?? "",
      /default-src 'none'/,
      path,
    );
    assert.match(
      header("content-security-policy") ?? "",
      /frame-ancestors 'none'/,
      path,
    );
    assert.equal(header("x-powered-by"), null, path);
    assert.ok(header("x-request-id"), path);
  }
});

test("the public pages only load assets the policy allows", async () => {
  const csp = (await fetch(`${h.base}/privacy`)).headers.get(
    "content-security-policy",
  )!;
  for (const page of ["/", "/privacy", "/terms"]) {
    const html = await (await fetch(`${h.base}${page}`)).text();
    // No inline scripts or styles, which the policy would block.
    assert.doesNotMatch(html, /<script|<style| style=/i, page);
    for (const [, url] of html.matchAll(/(?:href|src)="(https:\/\/[^/"]+)/g)) {
      if (url === "https://developers.google.com") continue; // a link, not an asset
      assert.ok(
        csp.includes(url),
        `${page} loads ${url}, which the CSP must allow`,
      );
    }
  }
});
