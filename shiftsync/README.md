# ShiftSync

A phone-only React Native app built with TypeScript and Expo, following [the supplied design specification](./design-1.md).

## Preview without Android Studio

Install [Expo Go for SDK 57](https://expo.dev/go?sdkVersion=57&platform=android&device=true) on your Android phone. Connect the phone and computer to the same Wi-Fi network, then run:

```powershell
npm run start:go
```

Open Expo Go and scan the terminal's QR code. This previews the app without installing an Android SDK or compiling a native build. The app's current native libraries are supported by Expo Go. If your network prevents a LAN connection, try `npx expo start --go --tunnel` and accept the prompt to install the tunnel dependency if it appears.

## Run on Android

Node.js 24 LTS and npm are required. Dependencies are already installed in this workspace; a fresh checkout needs `npm install`.

```powershell
npm run android
```

The first run compiles and installs a development build. Install Android Studio, its Android SDK, and a supported Java development kit first, and start an emulator or connect a phone with USB debugging enabled. This workspace does not currently have an Android SDK configured.

If Expo reports that the SDK path or `adb` is missing, finish Android Studio's SDK setup first. In **Settings > Languages & Frameworks > Android SDK**, install **Android SDK Platform 36**, **Build-Tools 36.0.0**, **Android SDK Platform-Tools**, and **Android Emulator**. Copy the Android SDK Location shown there. For a default Windows installation, run this in the terminal you use to start the app:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
adb version
adb devices
npm run android
```

Replace `ANDROID_HOME` with the actual SDK Location if you installed it elsewhere. These commands set the paths for this terminal session. For a permanent setup, add `ANDROID_HOME` to Windows user environment variables and add `%ANDROID_HOME%\platform-tools` and `%ANDROID_HOME%\emulator` to the user Path, then restart your IDE. Start a virtual device in Android Studio's Device Manager, or attach a USB-debugging phone, before running the app. The app includes `expo-system-ui` for Android's system appearance support.

After installing the development build, start the JavaScript development server with:

```powershell
npm start
```

Use a development build when testing the app's own native configuration or preparing it for distribution. See [Expo's development build instructions](https://docs.expo.dev/develop/development-builds/introduction/?buildenv=build-locally) for Android setup or an EAS cloud-build alternative that does not require local Android Studio.

## Run on iOS

On a Mac with Xcode installed, use `npm run ios`. The iOS simulator cannot be run locally on Windows. A cloud development build can be prepared separately using an Expo account and appropriate Apple provisioning.

## Explore the app

Tap **Explore the demo** on the welcome screen to view the example schedule immediately. **Get Started** walks through profile creation and four onboarding steps.

- Home: today's plans, weekly health, upcoming items, quick actions, and CalenBud.
- Calendar: month, week, and day views; date navigation; category filters; search.
- Center +: add events, shifts, tasks, and unavailable time.
- Event forms and details: title, category (class, study, work, personal, important, other), date/time, location, notes, participants, recurrence, reminders, priority and shift status; fixed or flexible, deadline, splittable with a minimum block, and contacts to notify; edit and confirmed deletion.
- Shift impact: changing a shift's time previews every overlap and too-short gap it causes in the planning window, with a recovery preview, before anything is saved.
- Conflicts: overlaps, short gaps and availability issues, labelled fixed/flexible with a tracked status. Up to three ranked, explained new times (or a split-study plan) for flexible events, rechecked when chosen. Fixed-vs-fixed conflicts offer an editable message to your employer and/or professor.
- Shifts: upcoming, open and completed; local swap requests and cancellation.
- Tasks: due, upcoming and completed; checkbox and swipe completion.
- Availability: editable weekly hours, days off, preferred hours, restrictions and blocked dates.
- CalenBud: with an account, answers from your synced schedule using Gemini (grounded in your real events, conflicts and free time) and can turn "my shift tomorrow moved to 10am" into a reviewable Shift Impact preview; offline and in the demo it uses local rules. It never changes events by itself.
- Notifications: local schedule notices, swipe read/delete, and accessible action buttons.
- Profile: editable details, calendar connection information, settings, light/dark/system appearance, and logout.

Example data uses dates relative to the first launch rather than hard-coded dates. Schedule and preferences persist on the device. Calendar times use the phone's local time zone. An event or shift whose end time is earlier than its start (for example 10:00 PM to 1:00 AM) is saved as two items: 10:00 PM to 11:59 PM on the start date and 12:00 AM to 1:00 AM the next day.

## Accounts, backend and integrations

The app runs in two modes:

- **On-device demo** (no `EXPO_PUBLIC_API_BASE_URL`): everything is stored on the phone, as before. Recovery suggestions, explanations and email templates come from the same shared scheduling engine the server uses.
- **Accounts** (with `EXPO_PUBLIC_API_BASE_URL`): Log In / Sign Up create real Supabase accounts through the ShiftSync API in `server/`, by email or with **Continue with Google**. Google sign-in also connects Google Calendar and Gmail in the same step. Schedules sync across devices and work offline. Gemini writes explanations and email drafts from verified schedule facts, and Google Calendar and Gmail can be connected. "Explore the demo" still works offline.

Setup (database migration, server, app configuration, Google OAuth, EAS), the API, the safety rules and the status of every integration are in **[docs/INTEGRATION.md](docs/INTEGRATION.md)**. In short:

```powershell
# 1. Run supabase/migrations/20261012000000_shiftsync_core.sql in the Supabase SQL editor
# 2. Start the API (reads server/.env, then this folder's .env)
npm --prefix server install
npm run server
# 3. Point the app at it: add EXPO_PUBLIC_API_BASE_URL=http://<your-computer-LAN-IP>:4000 to .env, then
npx expo start -c
```

Secrets (Supabase, Gemini, Google) stay on the server; only `EXPO_PUBLIC_API_BASE_URL` is built into the app. Remote shift swaps and push delivery still need separately configured services, and the relevant screens say so.

CalenBud chat answers using the actual schedule and deterministic scheduling rules. Its available-hour suggestions consider availability, blocked time, event duration and buffer settings. Free-time questions that name today or tomorrow search only that day and report when no hour is available.

Recurring conflict resolution moves just the selected occurrence and preserves the rest of the series. Editing a recurring item from its details changes the whole series. Recurring suggestions and save warnings check a 14-day horizon; conflicts farther into the future may appear when they enter that horizon. Recurring shift lists show the next two weeks or the previous 30 days, with the correct occurrence dates.

Recurring task completion is stored per occurrence date. Today, Upcoming and Completed show the correct dated tasks; Upcoming includes recurring occurrences for the next two weeks. Older saved recurring tasks with a single completion flag retain completion on their original date, with subsequent occurrences left open.

## Verify

```powershell
npm run check:all      # app typecheck + tests, then server typecheck + tests
npm run export:native
npx expo install --check
```

Native bundle export verifies Metro compilation for Android and iOS. It does not produce an APK/IPA or prove device behavior. Review keyboard, screen-reader, swipe and safe-area behavior on physical devices before release.

Verified on October 12, 2026: app and server TypeScript passed; all 63 app tests (scheduling, Shift Impact Analysis, recovery, CalenBud, persistence, offline sync) and 30 server tests (API over HTTP including Google sign-in, chat and Calendar, and the SQL migrations with row level security in an embedded Postgres) passed; the Android Hermes bundle export passed and contains no API keys; `expo install --check` reports dependencies up to date. Not yet verified: the live Supabase project, live Gemini and Google calls, and on-device interaction (see [docs/INTEGRATION.md](docs/INTEGRATION.md#status)).

Verified on October 11, 2026: TypeScript passed; all 36 scheduling, persistence and assistant tests passed; Prettier checks passed; Android Hermes bundle export passed. Ten new regression tests cover requested-day availability, per-occurrence task completion, recurrence edits, legacy task data and completion-date persistence. Expo Doctor reports the existing non-square logo (371×302) as an icon validation issue; the supplied logo is retained at the user's request. The completed EAS Android build succeeded despite that warning. Device interaction still needs manual verification.

The dependency audit reports 23 inherited advisories (16 high, 7 moderate), primarily through the Expo/Metro toolchain, `node-forge`, `braces`, and `xcode`'s `uuid`. Compatible `npm audit fix` updates were applied. npm's remaining proposed fixes downgrade Expo/React Native across major versions, so they were not forced. Recheck upstream patches before shipping; this is not a clean security audit.

## Source layout

`src/domain/` contains pure scheduling functions, types and sample data, shared with the server: conflict rules (`policy`), Shift Impact Analysis (`impact`), recovery and scoring (`recovery`), templates (`messages`), time zones (`time`) and the API contract (`contract`). `src/store/` owns local persistence and the offline sync queue. `src/services/` is the API client and secure session storage. `src/components/` contains themed controls and calendar item cards. `src/screens/` groups the mobile features, and `src/navigation/` defines the typed stack and five-action tab bar. Poppins is bundled locally for offline use.

`server/` is the Express API (its own `package.json`; Metro never bundles it). `supabase/migrations/` holds the database schema.
