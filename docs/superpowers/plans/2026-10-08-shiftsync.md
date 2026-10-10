# ShiftSync Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Build the supplied ShiftSync mobile design in React Native and TypeScript.

**Architecture:** Expo app with a typed navigation stack, reusable mobile components, and a local persisted scheduling store. Pure scheduling functions own validation, recurrence, conflict detection, search, and available-time recommendations. Feature screens consume the store; schedule changes require an explicit user action.

**Tech Stack:** Expo, React Native, TypeScript, React Navigation, AsyncStorage, bundled Poppins fonts, native date/time picker, Node test runner through tsx.

**Spec:** `design-1.md` (user-supplied and authorized), with React Native and TypeScript selected by the user.

## Global Constraints

- Phone screens only; single columns, bottom sheets, persistent five-action bottom navigation.
- Preserve all seven specified palette tokens and Poppins weights 400, 500, 600, 700.
- Minimum 44px touch targets, safe areas, keyboard-aware forms, accessible control labels.
- CalenBud never silently changes schedules.
- Real authentication, cloud calendar sync, push delivery and AI inference require external services: clearly explain their local-demo boundary, never imply they are connected.

## Review Focus

- Invalid end times and missing titles must never enter the schedule.
- Adjacent appointments must not be classified as overlapping.
- Recommended times must respect duration, availability and existing commitments.
- Storage loading and failures must not silently overwrite existing data.
- Changes to events and task completion must propagate to all screens and persist on restart.

### Task 1: Scheduling model and tests

**Files:** `shiftsync/src/domain/{types,schedule,seed}.ts`, `shiftsync/tests/schedule.test.ts`.

**Interfaces:** `ScheduleItem`, `AvailabilityDay`, `Preferences`, `AppData`; pure `validateItem`, `findConflicts`, `suggestSlots`, `itemsOnDate`, `searchItems`, `answerScheduleQuestion` functions.

- [x] Write tests for overlap boundaries, gaps, unavailable days, duration, recurrence, task exclusion, search, and malformed form input.
- [x] Run `npm test` and observe failures before implementation.
- [x] Implement domain functions and date-relative sample data.
- [x] Run `npm test`; all cases must pass.

### Task 2: Mobile shell and persisted store

**Files:** `App.tsx`, `src/theme.ts`, `src/components/ui.tsx`, `src/store/AppStore.tsx`, `src/navigation/{types,AppNavigator}.tsx`.

**Interfaces:** typed root stack, five-action tab bar; `useApp` exposes persisted items, availability, preferences, profile and update actions.

- [x] Build splash, hydration and recoverable errors; serialize writes only after successful hydration.
- [x] Add bundled fonts, safe-area shell, tokens, buttons, cards, fields, CalenBud avatar, bottom sheet and empty states.
- [x] Build navigation with Home, Calendar, Add, Conflicts and Shifts plus full-screen child routes.
- [x] Run `npm run typecheck`; no errors.

### Task 3: Scheduling screens

**Files:** `src/screens/{HomeScreen,CalendarScreen,ItemScreens,ConflictScreens,ShiftsScreen,TasksScreen,AvailabilityScreen}.tsx`.

- [x] Build home timeline, health, upcoming, quick actions, and CalenBud card.
- [x] Add month/week/day calendar navigation, date selection and category-filter sheet.
- [x] Add event/shift/task/unavailable forms and detail actions, including delete confirmations.
- [x] Add conflict list and explicit resolution choices that revalidate suggested times before saving.
- [x] Add shifts, swap requests, task completion, weekly availability and scheduling restrictions.
- [x] Run typecheck and domain tests.

### Task 4: Entry, assistant and account screens

**Files:** `src/screens/{AuthScreens,OnboardingScreen,ChatScreen,AccountScreens}.tsx`.

- [x] Implement welcome and demo entry forms with input validation; never store passwords.
- [x] Implement role, availability, preferences and CalenBud onboarding.
- [x] Implement local CalenBud chat driven by real schedule data, suggested prompts and typing state.
- [x] Add search, swipe notifications, profile, editable settings and explicit integration explanations.
- [x] Run typecheck, tests and native platform bundle exports.

### Task 5: Verify and document

**Files:** `shiftsync/README.md`, `docs/superpowers/plans/2026-10-08-shiftsync-progress.md`.

- [x] Run Expo dependency checks, TypeScript, tests and Android/iOS JS exports.
- [x] Perform a fresh review against the supplied specification and fix material findings.
- [x] Document startup commands, implemented features, local demo boundaries and verification limits.

No existing git repository is present; preserve source files in the user's workspace without introducing a git workflow.

