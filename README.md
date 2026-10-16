# ShiftSync

**An AI-assisted mobile scheduling app for working college students.**

A calendar can store a schedule. ShiftSync helps students *recover* one.

Working students juggle classes, changing work shifts and personal commitments. When a shift moves and lands on a class, ShiftSync detects the conflict, keeps fixed commitments protected, offers options that actually work, and drafts the message to the professor or supervisor. The student stays in control: nothing changes until they confirm.

## Features

- **Conflict detection.** A rules engine checks shifts, classes and events against the student's availability and travel time over a 7-day window.
- **Recovery options.** Valid free times and suggested fixes are computed by rules, then explained in plain language.
- **CalenBud, the in-app assistant.** Ask about your schedule, or say "add dentist tomorrow 3pm". CalenBud can propose adding an item, removing an item or resolving a conflict. Every change shows a confirmation card and is saved only when the student taps.
- **Email drafts.** Generates a short, consistently formatted email (subject, greeting, paragraphs, closing) for the people affected by a conflict. Sending happens only after the student confirms.
- **Google integration (optional).** Sign in with Google, sync events to Google Calendar, and create or send Gmail drafts.
- **Works offline.** Local cache and an offline outbox, plus an on-device demo mode that needs no account.
- **Reminders.** Local notifications for upcoming items and conflicts.

## How it works

```
Mobile app (React Native + Expo)
        │  only talks to the API
        ▼
ShiftSync API (Node/Express, on Render)
        │
        ├── Supabase (Postgres + Auth, row level security)
        ├── AI providers: Groq → OpenRouter → Gemini (optional)
        └── Google OAuth, Calendar, Gmail (optional)
```

The app never calls Supabase, Google or an AI provider directly. Secrets stay on the server.

### Design principle: rules decide, AI explains

During development the AI sometimes invented times that didn't exist, and once told a student a change was "already added" when nothing had been saved. The design now guards against both:

- **Fixed rules** find conflicts and decide which times are valid. The AI only explains the options.
- **Confirm before any change.** CalenBud only *proposes*. Adding, removing and resolving all wait for a tap.
- **Grounded actions.** An add proposal must use a date and start time the student actually wrote. A remove proposal must name a real item. A resolve proposal must reference a real, current conflict.
- **No false claims.** The server blocks any reply that says a change was already made and replaces it with an honest proposal or a request for missing details.
- **Graceful failure.** If every AI provider fails, the app falls back to built-in rule-based answers and email templates.
- **Safe emails.** Drafts can't contain invented dates, times, addresses or links, and recipients are limited to contacts on the conflicting events.

## Tech stack

| Layer | Technology |
| --- | --- |
| App | React Native, Expo, TypeScript |
| Server | Node.js, Express, TypeScript |
| Database and auth | Supabase (Postgres, Auth, row level security) |
| AI (optional) | Groq, OpenRouter, Google Gemini |
| Google (optional) | OAuth 2.0 (PKCE), Calendar API, Gmail API |
| Hosting | Render (API), Expo EAS (Android builds) |
| CI | GitHub Actions (format, type-check, tests) |

The app and server share the same scheduling domain code (`src/domain/`), so conflict rules are written once.

## Project structure

```
shiftsync/
├── src/                 # Mobile app
│   ├── domain/          # Shared scheduling rules, assistant validation, API contract
│   ├── screens/         # App screens, including the CalenBud chat
│   ├── services/        # API client
│   └── store/           # App state
├── server/              # API server
│   ├── src/services/    # AI, assistant, email drafting, Google
│   ├── src/repo/        # Supabase adapter
│   └── tests/           # Server tests
├── supabase/migrations/ # Database schema
└── docs/                # INTEGRATION.md, RESOURCES.md
```

## Getting started

### Prerequisites

- Node.js (24 recommended, matching `render.yaml`)
- A Supabase project
- An Expo account (for Android builds)
- Optional: API keys for Groq, OpenRouter or Gemini, and a Google Cloud OAuth client

### 1. Database

Run the migrations in `supabase/migrations/` in order, using the Supabase SQL editor:

1. `20261012000000_shiftsync_core.sql`
2. `20261013000000_google_profile_names.sql`

Enable the Email provider in Supabase Auth.

### 2. Server

```bash
cd shiftsync/server
cp .env.example .env     # then fill in the values below
npm install
npm run dev
```

Health check: `GET /health` (also reports the active AI provider).

### 3. App

```bash
cd shiftsync
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_BASE_URL` to your server's URL to use real accounts. Leave it unset to run the on-device demo, where everything is stored on the phone.

### 4. Android build

```bash
cd shiftsync
eas build -p android --profile preview
```

Changes under `src/` (app code) need a new build. Server-only changes deploy on their own.

## Configuration

Set these in `server/.env` locally and in the Render dashboard for production. Never commit `.env` files.

| Variable | Needed for |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Everything (publishable key only; no service-role key is used) |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` | AI features (optional; any one enables AI) |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | Choosing Gemini models (optional, comma-separated fallbacks) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` | Google sign-in, Calendar, Gmail (all four, or Google stays off) |
| `EXPO_PUBLIC_API_BASE_URL` | App: points the app at the API (public, never a secret) |

`GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` must be identical everywhere the server runs, or tokens stored by one copy can't be read by another.

Without any AI key, explanations and email drafts use built-in templates.

## Testing

```bash
# App
cd shiftsync && npm test

# Server
cd shiftsync/server && npm test
```

The tests use fake AI responses to cover hallucinated times, overloaded providers, retries, fallback models, wrong item references and false "already done" claims. The server tests run against an in-memory Postgres (PGlite). CI runs formatting, type-checks and tests on every push and pull request.

## Deployment

- **API:** Render, configured by `render.yaml`. Pushes to `main` deploy automatically. The free plan sleeps when idle, so the first request after a pause can be slow.
- **App:** Expo EAS builds (`preview` for an installable APK, `production` for store builds).

## Documentation

- [docs/INTEGRATION.md](docs/INTEGRATION.md): architecture, setup, API and safety rules
- [docs/RESOURCES.md](docs/RESOURCES.md): every external service and the settings that connect it

## Status and known limitations

- Free-tier AI providers can be rate limited or overloaded; the app retries, tries fallback models, then uses rule-based answers.
- Free-tier AI providers may use prompts to improve their products. Use paid tiers with no-training terms for a real launch.
- Not yet verified against live services: the Supabase migration on the production project, Google Calendar and Gmail calls, and a full Android device walkthrough (keyboard handling, OAuth return link, offline banner).
- Two-factor authentication is not implemented. Sign-in uses email and password, or Google sign-in.
- Notifications are local only. There is no push service yet.
- Repeating items can't be removed from chat; edit the series instead.

## Roadmap ideas

- Optional auto-apply setting for trusted actions
- Push notifications
- Two-factor authentication
- Play Store release and verified Google OAuth

## Team

**Micha Cruz**  — UI/UX & front end: Designed and built the app's screens (Home, Calendar, Conflicts, Email review, CalenBud chat), with one consistent look, light and dark mode, and mobile-friendly controls.

**Mark Jacob Martus**  — Back end & scheduling logic: Built conflict detection, the rules that keep classes and shifts fixed, rescheduling of flexible study time, and the server and database that keep each student's data private.

**Zyrus Ponce** — AI integration, Google APIs & testing: Connected CalenBud's AI with backup models and safety checks, integrated Google sign-in, Calendar sync and Gmail, and led testing.
We used AI coding assistants to help write code from our requirements. Each of us reviewed and tested our own part.


## License

Add a license here.
