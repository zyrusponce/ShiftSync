# ShiftSync backend and integrations

How the mobile app, API server, Supabase, Gemini, Google Calendar and Gmail fit together, how to set them up, and what is finished.

**Contents:** [Architecture](#architecture) · [Setup](#setup) · [How it works](#how-it-works) · [API](#api) · [Testing](#testing) · [Status](#status)

## Architecture

```text
Expo app (React Native + TypeScript)
  src/screens, src/components    existing UI, plus Shift Impact and Compose screens
  src/store                      AppStore (local cache + offline outbox), useRecovery
  src/services                   API client, secure session storage (expo-secure-store)
        │  HTTPS + the user's Supabase access token
        ▼
API server  (server/, Node + Express 5 + TypeScript)
  routes/      auth · events · contacts · preferences · conflicts · suggestions
               ai · notifications · gmail · google · calendar
  services/    Gemini (REST), Google OAuth/Calendar/Gmail (REST), token encryption
  repo/        Supabase adapter (per-user client, RLS enforced)
        │
        ▼
Supabase Postgres  (supabase/migrations)   row level security on every table

src/domain/   shared pure TypeScript used by BOTH the app and the server:
              schedule · policy · impact · recovery · messages · time · contract
```

- **Scheduling is deterministic and shared.** Conflict detection, Shift Impact Analysis, recovery search, scoring and split-study plans live in `src/domain` and run identically on the phone (demo/offline) and the server (accounts).
- **The app never talks to Supabase, Gemini or Google directly.** It only calls the API. No keys are in the app bundle; this was checked by searching the exported Android bundle.
- **Two modes.** Without `EXPO_PUBLIC_API_BASE_URL` the app is the existing on-device demo. With it, Log In / Sign Up create real accounts, and "Explore the demo" still works offline.

## Setup

### 1. Database (Supabase)

1. Open the Supabase dashboard → **SQL Editor** and run [`supabase/migrations/20261012000000_shiftsync_core.sql`](../supabase/migrations/20261012000000_shiftsync_core.sql). With the Supabase CLI linked to the project, `supabase db push` does the same. The script can be run more than once safely.
2. It creates `users`, `events`, `contacts`, `event_contacts`, `conflicts`, `suggestions`, `notifications`, `google_connections` and `idempotency_keys`. It also adds RLS policies, a trigger that creates a `users` row for each new account, and the `shiftsync_apply_recovery` function.
3. **Authentication → Providers → Email** must be enabled. If "Confirm email" is on (the default), new users must click the emailed link before logging in; the app tells them so.

The existing project's schema could not be inspected from here (no database credentials, and probing the live project was not permitted). Check that it has no conflicting `public.users` / `public.events` tables before running the script. It uses `create table if not exists`, so an existing table with a different shape would be left as it is and would break the API.

### 2. API server

```powershell
cd server
npm install
copy .env.example .env   # then fill it in
npm run dev              # http://0.0.0.0:4000, reloads on changes
```

The server validates its configuration on startup and lists anything missing. It already reads the existing names in `shiftsync/.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_google_gemini_api_key`, `VITE_GOOGLE_CLIENT_ID`), so nothing has to be duplicated. Over time, move the Gemini key into `server/.env` as `GEMINI_API_KEY`: keeping secrets out of the app folder removes the risk of someone renaming it to `EXPO_PUBLIC_…` and shipping it.

| Variable                                                                                               | Needed for                 | Notes                                                                          |
| ------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------ |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`                                                             | Everything                 | Publishable/anon key only. No service-role key is used.                        |
| `GEMINI_API_KEY`, `GEMINI_MODEL`                                                                       | AI explanations and drafts | Optional; templates are used without it. Model defaults to `gemini-3.8-flash`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` | Calendar + Gmail           | All four or Google stays off. See step 4.                                      |
| `PORT`, `HOST`, `TRUST_PROXY`, `APP_RETURN_URL_PREFIXES`                                               | Hosting                    | Defaults: `4000`, `0.0.0.0`, `false`, `shiftsync://,exp://`.                   |

Check it is up: `GET /health` returns `{"status":"ok","ai":true,"google":false}`.

### 3. Mobile app

Add to `shiftsync/.env` (see [`.env.example`](../.env.example)), then restart Expo with `npx expo start -c`:

```dotenv
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.20:4000
```

- **Physical phone:** use your computer's LAN address, not `localhost`. Allow port 4000 through the Windows firewall.
- **Emulator:** `http://10.0.2.2:4000`, or run `adb reverse tcp:4000 tcp:4000` and use `http://localhost:4000`.
- **APK (EAS preview build):** `.env` is git-ignored and not uploaded to EAS. Set the variable for the build with `eas env:create --name EXPO_PUBLIC_API_BASE_URL --value https://your-api-host --environment preview`, or add it to the `preview` profile's `env` in `eas.json`. Release builds block plain `http://`, so the API must be on **https** (deploy `server/` to Render/Railway/Fly, or use a tunnel).
- `app.json` now declares the `shiftsync://` scheme and the `expo-secure-store` / `expo-web-browser` plugins. **Rebuild the development build** (`npm run android` or a new EAS dev build) before using a dev client; Expo Go works without rebuilding.

### 4. Sign in with Google, Calendar and Gmail (optional)

1. In Google Cloud Console, enable the **Google Calendar API** and **Gmail API**.
2. Configure the OAuth consent screen and add the scopes `openid`, `email`, `profile`, `…/auth/calendar.events` and `…/auth/gmail.compose`. `gmail.compose` is a _restricted_ scope: keep the app in **Testing** and add each tester's Google account under _Test users_. Publishing for everyone requires Google's verification and security assessment.
3. Create an OAuth client of type **Web application**. Add `GOOGLE_REDIRECT_URI` (e.g. `https://your-api-host/api/google/callback`) to _Authorized redirect URIs_. The existing `VITE_GOOGLE_CLIENT_ID` can be reused only if it is a Web client and you have its secret.
4. Put the four `GOOGLE_*` values in `server/.env` and restart the server.
5. **For Sign in with Google**, in the Supabase dashboard go to **Authentication → Sign In / Providers → Google**, turn it on, and enter the same Web client ID and secret. The server signs students in with the Google ID token it receives (`signInWithIdToken`), so this client ID must be allowed there. If it is off, the app shows "Google sign-in isn't enabled" and email login still works. Google and email accounts with the same address are linked by Supabase.
6. Run the second migration, [`20261013000000_google_profile_names.sql`](../supabase/migrations/20261013000000_google_profile_names.sql), so Google sign-ups get their name on their profile.

In the app:

- **Continue with Google** (Log In or Sign Up) signs in, creating the account the first time, and connects Calendar and Gmail with one consent. The server keeps the Google tokens encrypted. The app only receives its ShiftSync session, through a one-time handle protected by PKCE: the app proves it started the sign-in, so an intercepted deep link is useless.
- Students who use email can link Google later in **Profile → Connected Services → Connect Google**.

The redirect URI must be reachable from the phone's browser. For local testing, `http://localhost:4000/api/google/callback` works on an emulator or USB-connected phone after `adb reverse tcp:4000 tcp:4000`. Otherwise use an https deployment or tunnel.

### 5. Deploy the API for APK builds (Render)

An APK is a release build: it blocks plain `http://`, and `localhost` on a phone is the phone. The API and the Google redirect therefore need a public https address. [`render.yaml`](../../render.yaml) at the repository root describes the service: it deploys the `shiftsync` folder, installs only `server/` dependencies, starts the API and checks `/health`.

1. Commit and push the `shiftsync/` folder (with `render.yaml` at the repository root) to GitHub. `server/.env` and `.env` are git-ignored and stay on your PC.
2. In Render: **New → Blueprint**, pick the repository. Render asks for each secret once:

   | Render variable                     | Value from                                                |
   | ----------------------------------- | --------------------------------------------------------- |
   | `SUPABASE_URL`                      | `VITE_SUPABASE_URL` in `shiftsync/.env`                   |
   | `SUPABASE_PUBLISHABLE_KEY`          | `VITE_SUPABASE_PUBLISHABLE_KEY` in `shiftsync/.env`       |
   | `GEMINI_API_KEY`                    | `VITE_google_gemini_api_key` in `shiftsync/.env`          |
   | `GOOGLE_CLIENT_ID`                  | `VITE_GOOGLE_CLIENT_ID` in `shiftsync/.env`               |
   | `GOOGLE_CLIENT_SECRET`              | `server/.env`                                             |
   | `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` | `server/.env` (use the same value)                        |
   | `GOOGLE_REDIRECT_URI`               | `https://<your-service>.onrender.com/api/google/callback` |

3. Once deployed, open `https://<your-service>.onrender.com/health`. It should show `{"status":"ok","ai":true,"google":true}`.
4. In Google Cloud Console, add `https://<your-service>.onrender.com/api/google/callback` to the OAuth client's **Authorized redirect URIs**. Keep the localhost one for local testing.
5. Point the APK at the server by adding this to the `preview` profile in `eas.json`, then build with `eas build -p android --profile preview`:

   ```json
   "env": { "EXPO_PUBLIC_API_BASE_URL": "https://<your-service>.onrender.com" }
   ```

On Render's free plan the service sleeps when idle, so the first request afterwards takes about 50 seconds; the app waits up to 60 seconds. Run a single instance, because Google sign-in hand-offs and rate limits are kept in memory.

## How it works

### Fixed vs flexible and conflict policy (`src/domain/policy.ts`)

- Work shifts, classes, work events and unavailable time are **fixed** by default; study, personal and other events are **flexible**. The editor's _Fixed commitment_ switch overrides the default, and changing the category resets it to the new default.
- Fixed vs flexible: the flexible one moves. Flexible vs flexible: the lower priority moves; on a tie the student chooses. Fixed vs fixed: nothing moves, and the student is offered communication instead.
- Required gap between two commitments = break (`Buffer time`, at least 15 minutes with _Avoid back-to-back_) + travel time when both have different in-person locations (`Online`, `Remote`, `Zoom`… count as no travel).

### Shift Impact Analysis (`src/domain/impact.ts`)

Editing a shift's date, times or repetition opens **Shift impact** instead of saving. Within the planning window (default 7 days, Settings → Calendar), it reports:

- **Direct conflicts** (overlaps) and **buffer conflicts** (too little break/travel time), each marked fixed or flexible and whether it already existed before the change.
- Conflicts the change **clears**.
- A **recovery preview** for every flexible commitment, planned in order of deadline, then priority. Each planned block is reserved, so later suggestions cannot collide with it.
- **Potential knock-on effects** of that plan, labelled as hypothetical.

Nothing is saved until **Confirm shift change**. After confirming, each affected item links to _Find a new time_ or _Contact someone_.

### Recovery engine (`src/domain/recovery.ts`)

1. Candidates are generated every 15 minutes from now to the end of the window (stopping at the deadline), keeping the original duration.
2. **Hard constraints first:** availability hours, not in the past, ending before the deadline, and no overlap with any commitment (gaps included) or reserved block. Only valid slots are scored.
3. `Score = 0.35·DeadlineSuitability + 0.25·StudyPreference + 0.20·ClosenessToOriginal + 0.20·BreakTravelQuality`, each 0–1. Weights live in `preferences.recoveryWeights` and are normalised.
4. Up to three non-overlapping options, each with a plain-language explanation.
5. If no full-length slot exists and the event is **splittable**, the engine tries plans of 2–4 blocks, each at least the minimum block length, with the same total time. Otherwise it returns `NO_FEASIBLE_SLOT` with the reason.
6. On approval the plan is **re-validated against the current schedule** (and the live Google Calendar when connected). Then it is applied atomically by the `shiftsync_apply_recovery` database function, guarded by the event's version, so a stale or repeated approval changes nothing.

### AI (Gemini) guardrails (`server/src/services/communication.ts`)

- Gemini receives only facts the scheduling engine produced (titles, times, fixed/flexible, the issue). It never decides overlaps, times, recipients or sending.
- Every answer is checked before use: any time, date or weekday not in the facts, any email address, link, placeholder or relative date ("tomorrow") rejects it.
- When AI is off, unavailable or rejected, a deterministic template from `src/domain/messages.ts` is used and the app says so. Scheduling never depends on AI.

### CalenBud chat (`server/src/services/assistant.ts`, `src/domain/assistant.ts`)

- For signed-in students, CalenBud answers with Gemini from facts the server computes: the next 7 days of commitments (fixed or flexible, deadlines), detected conflicts, free time (inside availability, with breaks kept), and the shifts that can be changed. In the demo, or offline, it uses the on-device rule-based answers, and says so.
- The same grounding check applies, except "today/tomorrow" is allowed because a chat reply is read straight away. Times and dates the student typed also count as known.
- **Natural-language changes:** "My shift tomorrow moved to 10am" can produce a _Preview Shift Change_ button. The server accepts the proposal only if the shift exists, the start time appears in the student's message, the end time comes from the message or keeps the shift's length, and the date is one the message names or the shift's own date. The button opens Shift Impact; nothing is saved until the student confirms there. Repeating shifts are edited in the shift editor instead.

### Gmail safety

- Recipients can only be contacts linked to one of the conflicting events. The student picks work, school, both, or none; "both" creates two separate messages.
- Messages are fully editable. **Save Draft** creates or updates a Gmail draft. **Send Email** requires an explicit confirmation showing the exact address, `confirmed: true`, a matching `recipientEmail`, and an `Idempotency-Key`.
- Status per message: Prepared → Draft saved → Sent / Not sent. A draft is never marked sent, and a failure is never reported as delivered. Sending marks the conflict _Contacted_, never _Resolved_; only the student resolves it.
- Without Gmail, every message can be copied, and the student can mark _I sent it myself_.

### Google Calendar sync

- **Import:** timed events from the primary calendar (yesterday to +14 days) become **fixed** ShiftSync events linked by Google event ID. It runs automatically after signing in and when the app comes back to the foreground (at most every 15 minutes), and on demand with **Sync Calendar Now**. Re-syncing updates rather than duplicates. All-day and overnight events are skipped and counted. Events edited in both places are listed under _Needs review_ instead of being overwritten.
- **Edits:** changing the time, title or location of a linked event in ShiftSync **patches the same Google event**, guarded by its etag. Approving a recovery does the same. If the event changed in Google meanwhile, Google is not overwritten: the ShiftSync change is kept and the app shows a notice. Extra split blocks are created in Google tagged with their ShiftSync ID, so a retry finds them instead of duplicating. Deleting in ShiftSync never deletes in Google.
- **Add to Google Calendar** on a shift's or event's details screen adds it once and links it; retries find the existing copy. Repeating series are not exported.
- Tokens are AES-256-GCM encrypted at rest. Expired grants show _Reconnect_, and **Disconnect** revokes the token.

### Offline and sync (`src/store/sync.ts`)

Signed-in changes are applied locally first, then queued (persisted across restarts) and sent in order. If offline, the queue waits and retries on reconnect or when the app returns to the foreground. If the server rejects a change (for example it was edited on another device: `VERSION_CONFLICT`), the queue drops it, shows the reason, and reloads the server's copy. IDs are UUIDs created on the device, so a retried create is recognised instead of duplicated.

## API

All `/api/*` routes except auth and the Google callback require `Authorization: Bearer <access token>`. The user ID always comes from the verified token, never from the request body. Errors look like `{"error":{"code":"…","message":"…","requestId":"…"}}`. Shared request/response types are in [`src/domain/contract.ts`](../src/domain/contract.ts).

| Method                      | Endpoint                                                                                      | Purpose                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| POST                        | `/api/auth/signup`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`                | Accounts (Supabase Auth)                                                      |
| POST                        | `/api/auth/google/start`, `/api/auth/google/complete`                                         | Sign in with Google (PKCE `codeChallenge` / `codeVerifier`)                   |
| POST                        | `/api/ai/chat`                                                                                | CalenBud reply from verified facts, with an optional reviewable action        |
| POST                        | `/api/calendar/events/:id`                                                                    | Add an event to Google Calendar (once)                                        |
| GET / POST                  | `/api/events`                                                                                 | List (`?from&to&category&kind&upcoming=true`) / create (idempotent by `id`)   |
| PATCH / DELETE              | `/api/events/:id`                                                                             | Partial update (`expectedVersion` optional, `deadline: null` clears) / delete |
| GET / POST / PATCH / DELETE | `/api/contacts`, `/api/contacts/:id`                                                          | Event contacts                                                                |
| GET / PATCH                 | `/api/preferences`                                                                            | Profile, preferences, availability                                            |
| GET                         | `/api/conflicts`                                                                              | Detected conflicts with tracked status                                        |
| PATCH                       | `/api/conflicts/:id/status`                                                                   | `unresolved`, `draft_prepared`, `user_contacted`, `resolved`, `dismissed`     |
| POST                        | `/api/conflicts/analyze`                                                                      | Shift Impact preview (no writes)                                              |
| POST                        | `/api/suggestions`                                                                            | Up to 3 ranked options, or `NO_FEASIBLE_SLOT` / `NOT_MOVABLE`                 |
| POST                        | `/api/suggestions/:id/approve`                                                                | Revalidate and save; requires `Idempotency-Key`                               |
| POST                        | `/api/ai/explain`, `/api/ai/draft`                                                            | Grounded explanation; one draft per chosen contact                            |
| GET                         | `/api/notifications`                                                                          | Message statuses (`?conflictId=`)                                             |
| POST                        | `/api/gmail/drafts`, `/api/gmail/send`                                                        | Save draft; confirmed send (requires `Idempotency-Key`)                       |
| GET / POST                  | `/api/google/status`, `/api/google/connect`, `/api/google/complete`, `/api/google/disconnect` | Google connection                                                             |
| GET                         | `/api/google/callback`                                                                        | OAuth redirect target (public)                                                |
| POST                        | `/api/calendar/sync`                                                                          | Import from Google Calendar                                                   |

Error codes: `UNAUTHORIZED`, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT_DETECTED`, `VERSION_CONFLICT`, `DUPLICATE_EVENT`, `NO_FEASIBLE_SLOT`, `STALE_SUGGESTION`, `REQUEST_IN_PROGRESS`, `SYNC_FAILED`, `GOOGLE_NOT_CONNECTED`, `GOOGLE_NOT_CONFIGURED`, `EMAIL_SEND_FAILED`, `AI_SERVICE_UNAVAILABLE`, `EMAIL_NOT_CONFIRMED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## Testing

```powershell
npm run check:all      # app typecheck + tests, then server typecheck + tests
npx expo export --platform android   # Metro/Hermes bundle check
```

- `tests/` (app, 63 tests): scheduling, recovery engine, CalenBud parsing and action checks, persistence, offline sync.
- `server/tests` (30 tests): the real Express app over HTTP, including Sign in with Google, CalenBud chat and Google Calendar edits, with an in-memory repo and fakes for Supabase Auth, Gemini and Google. Also runs the real SQL migration in an embedded Postgres (PGlite) to check RLS, constraints and the approval function.

| Spec scenario                         | Covered by                                                              |
| ------------------------------------- | ----------------------------------------------------------------------- |
| 1 Shift overlaps flexible study       | `tests/recovery.test.ts` #1                                             |
| 2 Shift overlaps fixed class          | `tests/recovery.test.ts` #2                                             |
| 3 Two flexible events                 | `tests/recovery.test.ts` #3                                             |
| 4 Three or more affected              | `tests/recovery.test.ts` #4, #4b                                        |
| 5 No valid time                       | `tests/recovery.test.ts` #5                                             |
| 6 Split study                         | `tests/recovery.test.ts` #6                                             |
| 7 Slot taken before approval          | `tests/recovery.test.ts` #7, `server/tests/api.test.ts` #7              |
| 8 Moving a fixed event                | `tests/recovery.test.ts` #8, `server/tests/api.test.ts` #8              |
| 9 Employer chosen over professor      | `server/tests/api.test.ts` "9, 10, 14" and "9-12"                       |
| 10 Both contacts, separate emails     | `server/tests/api.test.ts` "9, 10, 14" and "9-12"                       |
| 11 Gmail send fails                   | `server/tests/api.test.ts` "9-12"                                       |
| 12 Calendar update without duplicates | `server/tests/api.test.ts` #12                                          |
| 13 Data survives restart              | `tests/persistence.test.ts` #13                                         |
| 14 Gemini unavailable                 | `server/tests/api.test.ts` "9, 10, 14", `server/tests/units.test.ts`    |
| 15 Another user's schedule            | `server/tests/api.test.ts` #15, `migration.test.ts` #15                 |
| 16 Repeated approval                  | `server/tests/api.test.ts` (shift impact test), `migration.test.ts` #16 |

## Status

### Completed and verified by automated checks

- Shared scheduling engine: fixed/flexible rules, Shift Impact Analysis, ranked recovery with configurable weights, deadlines, travel/break buffers, split-study plans, revalidation.
- API server with every endpoint above, validation, structured errors, idempotent approval and sending, rate limits, and privacy-safe logs (IDs, codes and timings only).
- Supabase schema, RLS and the atomic approval function, verified in Postgres 17 (PGlite), including running the migration twice.
- Sign in with Google (account + Calendar + Gmail in one consent, PKCE-protected), CalenBud chat grounded in the schedule with reviewable shift-change proposals, Google Calendar edit push and Add to Google Calendar, automatic calendar import.
- Mobile integration: real sign-up/login, session in the secure keystore, offline outbox, Shift Impact screen, ranked recovery with explanations and split plans, Compose with recipient choice/edit/save/send/copy, conflict status tracking, Connected Services, travel time and planning window settings, contacts and recovery fields in the editor. Typecheck and the Android Hermes bundle export pass, and the bundle contains no keys.
- The server starts against the existing `.env` (Supabase and Gemini found; Google reported as not configured).

### Implemented, not yet verified against live services

- **Supabase:** the migration has not been applied to the real project, and the Supabase adapter (`server/src/repo/supabase.ts`) has only been typechecked. Run the migration, then sign up from the app and walk through the core flow.
- **Gemini:** the client is tested against a fake HTTP server only. Confirm the key works with the default `gemini-3.8-flash` model (or set `GEMINI_MODEL`).
- **Sign in with Google, Google Calendar and Gmail:** blocked on `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY`, plus the Google provider in Supabase for sign-in. The REST calls follow Google's documented endpoints but have not been made against Google.
- **Android device:** no Android SDK or emulator was available, so no screen has been tapped through on a device. Check keyboard handling in the editor's contact form and Compose, the OAuth return deep link, and the offline banner.

### Not done (by design or out of scope)

- **Automatic email sending:** emails are always reviewed and confirmed before sending, as aiIntegration.md requires (re-confirmed when progress.md was implemented).
- Microsoft sign-in, password reset, push notifications.
- Recurring local series are not pushed to Google. Google recurring events are imported as individual occurrences.
- OAuth hand-off handles and rate limits are kept in server memory, so run a single API instance (or move them to Redis/Postgres before scaling out).
- Data from the on-device demo is not imported into a new account.
