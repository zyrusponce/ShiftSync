# ShiftSync — Full Product Definition (Revised Hackathon Plan)

**Version:** 2.0 · **Positioning:** Working-student schedule recovery assistant · **Product principle:** Detect → Recover → Communicate

## 1. Product concept

ShiftSync is a mobile **schedule recovery assistant** for working students. It detects the ripple effects of sudden work-shift changes, protects commitments that cannot be moved, analyzes every affected activity, recommends safe recovery plans for flexible activities, and helps students communicate when fixed commitments conflict. Unlike a general calendar, ShiftSync focuses on what to do **after an unexpected schedule disruption**.

Its core promise is:

> When your work schedule suddenly changes, ShiftSync shows what is affected, proposes a realistic recovery plan, and helps you act without rebuilding your calendar manually.

**Unique value proposition:** Shift Impact Analysis + Smart Schedule Recovery + Communication Support. The combination should be tested against existing scheduling tools rather than claimed to be wholly new.

## 2. Target users

ShiftSync is designed for students who:

- Work part-time or changing shifts.
- Attend regularly scheduled classes.
- Arrange study sessions around school and work.
- Experience sudden work-schedule changes.
- Currently resolve conflicts manually using calendars, messages, and email.

## 3. Event hierarchy

Events are organized according to how movable they are.

- **Work shifts:** Fixed by default and cannot be moved automatically.
- **Classes:** Fixed by default and cannot be moved automatically.
- **Deadline-related study sessions:** Flexible but must be completed before their deadline.
- **Regular study sessions:** Flexible and may be rescheduled.
- **Personal or other events:** Flexible unless the student marks them as fixed.

Students can assign priorities to **all flexible events** (and optionally to fixed events for display/urgency), but priority never makes a fixed event automatically movable. Exam and deadline proximity can raise the urgency of affected flexible study tasks.

## 4. Event information

**Required fields (fast entry):**

- Event name
- Category
- Date, start time, and end time

**Optional / advanced fields (with sensible defaults):**

- Fixed or flexible status (default inferred from category, always editable)
- Priority, preferred study time, and splittable status
- Deadline and minimum acceptable study-block length
- Recurrence (post-MVP unless simple handling is available)
- Location, travel-time allowance, and break preference
- Contact name and email address

A user should not need to enter a contact email to create an event.

Contact information is particularly important for work shifts and classes because it allows ShiftSync to prepare a message when two fixed events overlap.

Google Calendar synchronization is a **stretch integration for the hackathon MVP**, not a prerequisite for the local recovery workflow. Store an external calendar event ID when linked; allow locally created events to work without Google.

## 5. Conflict-resolution rules

### Fixed event and flexible event

Suppose a work shift changes to 10:00 AM and overlaps a study session.

ShiftSync will:

1. Detect the overlap.
2. Keep the work shift unchanged.
3. Search for available replacement periods.
4. Preserve the original duration where possible; if no full-length slot exists, offer an **optional split-study plan** while preserving the total intended duration.
5. Generate up to three valid alternatives; never fabricate a third slot.
6. Rank the alternatives from best to least suitable.
7. Explain why each time was recommended.
8. Let the student approve one option.
9. Revalidate the proposed slot at approval time, then update ShiftSync. If Calendar is connected, update the same Google event and report any synchronization failure without silently duplicating it.

### Two flexible events

When two flexible events overlap, ShiftSync recommends moving the event with the lower priority.

If both have the same priority, the student chooses which one to move.

### Two fixed events

When a work shift overlaps a class, ShiftSync cannot safely move either event.

Instead, the app will:

1. Display both conflicting events.
2. Explain that neither event can be moved automatically.
3. Display the employer and professor contact details.
4. Let the student choose whom to contact.
5. Use AI to generate an appropriate message.
6. Prepare an editable message in-app and, if Gmail integration is enabled, create a Gmail draft.
7. Require the student to review and approve the **draft creation**. Track the conflict as pending until the student explicitly marks it resolved; creating a draft is not proof a recipient was contacted.

The app must never send the message automatically. A fixed-versus-fixed conflict has states such as **Unresolved → Draft Prepared → User Contacted → Resolved** (or dismissed). ShiftSync does not assume that a draft was sent or that the other person agreed.

## 6. Suggested-time ranking

Every suggested time must:

- Avoid work shifts and classes, as well as all other non-movable events.
- Avoid creating another calendar conflict, including with other proposed moves.
- Include configured travel and preparation buffers where relevant.
- Preserve the activity’s required duration, **or** total duration across an explicitly approved split-session plan.
- Occur before any relevant deadline and respect valid start/end boundaries.
- Use the student’s local timezone consistently.
- Be checked again immediately before approval.

Valid times are then ranked according to:

1. The student’s preferred study hours.
2. Proximity to the original schedule.
3. Available preparation and travel time.
4. Adequate breaks between events.
5. The priority of the affected activity.
6. Upcoming deadlines.
7. Overall Google Calendar availability.

ShiftSync should present **up to three** strong suggestions instead of every possible time. If no valid full-duration option exists, offer split-study blocks (when allowed), a wider search window before the deadline, or a clear **No feasible slot** result. Do not compromise hard constraints to reach three suggestions.

**Initial, adjustable ranking formula (only after filtering invalid slots):**

`Score = 0.35 × DeadlineSuitability + 0.25 × StudyPreference + 0.20 × ClosenessToOriginal + 0.20 × BreakTravelQuality`

Each component is normalized from 0 to 1. These weights are design hypotheses to validate with students, not established scientific parameters. Activity priority is used to decide which flexible commitments to recover first. Google Calendar availability is an input to constraint checking when connected, rather than an AI guess.

## 7. Role of AI

AI will be responsible for:

- Generating context-aware email drafts.
- Adjusting the tone for a professor or employer.
- Summarizing **all impacted events** and explaining which are direct overlaps versus buffer/knock-on impacts.
- Including verified dates and times.
- Explaining why particular replacement times were recommended.
- Optionally understanding commands such as, “My work shift moved to 10 AM—help me fix my schedule.”

AI will not be responsible for:

- Calculating whether two times overlap.
- Deciding that a fixed event can be moved.
- Inventing free time that is not available.
- Selecting the message recipient without the student.
- Sending a message without approval.

The scheduling engine should use deterministic rules for reliability. AI should handle language, explanations, and conversational interaction.

## 8. Main mobile screens

### Home screen

The home screen displays:

- Today’s schedule
- Upcoming events
- Active conflicts
- Conflict alerts
- A button for adding an event

### Add Event screen

This screen collects:

- Event details
- Category
- Priority
- Fixed or flexible status
- Contact information
- Deadline and recurrence information

### Shift Impact / Conflict Alert screen

This screen shows:

- The changed work shift and **all affected events**
- Direct overlaps, insufficient travel/break buffers, and knock-on scheduling impacts, clearly labeled
- Event categories, priorities, deadlines, and fixed/flexible status
- Recovery options and affected-event count
- A clear warning when no feasible solution exists

### Suggested Times screen

This screen displays:

- Up to three ranked replacement times, or an explicit no-slot explanation
- A short explanation for every suggestion
- The original event time
- An optional split-study recovery suggestion when needed
- A button for approving the selected suggestion

### Contact Resolution screen

This screen allows the student to:

- Choose between the professor and employer
- Generate an AI-assisted message
- Edit the draft
- Review its recipient and schedule details
- Approve creation of a Gmail draft (when connected), or copy the text
- View and update conflict resolution status

### Preferences screen

The student can configure:

- Preferred study periods
- Minimum break duration
- Travel-time allowance
- Working hours
- Google Calendar connection
- Gmail connection

## 9. Recommended hackathon MVP

**Essential end-to-end demo (must work without third-party integrations):**

1. The student opens ShiftSync with a local demo account / seeded sample schedule.
2. The student views classes, a work shift, an exam-review session, and another flexible task.
3. A changed work shift causes a direct overlap and possibly a travel-buffer issue.
4. **Shift Impact Analysis** shows all affected commitments, not just the first overlap.
5. The rule-based engine distinguishes fixed and flexible commitments.
6. ShiftSync recommends up to three valid recovery options; optional split blocks are offered if no full slot fits.
7. The student reviews the impact and approves one recovery plan.
8. ShiftSync revalidates and saves approved changes locally.
9. A second scenario creates a work-versus-class conflict.
10. The student chooses whom to contact; AI prepares a verified-data-based, editable message.
11. The student copies the message or creates a Gmail draft if integration is ready.
12. ShiftSync tracks the issue as unresolved until the student changes its status.

**Stretch live integrations (show only when working reliably):** Google sign-in, Calendar read/update, and Gmail draft creation. Do not let OAuth issues break the core demonstration.

This complete workflow will create a stronger demonstration than numerous unfinished features.

## 10. Success criteria

The prototype is successful when:

- Schedule overlaps are detected correctly.
- Fixed and flexible events are treated differently.
- Suggested times do not create new conflicts.
- Up to three ranked valid alternatives are displayed; zero-slot states are handled correctly.
- Impact analysis identifies all relevant direct conflicts and buffer violations.
- Recovery suggestions honor deadlines and configured breaks/travel time.
- Approvals are revalidated before saving.
- The student can approve a replacement quickly.
- Approved changes persist locally; if Google Calendar is connected, the same event is updated without duplication.
- AI generates a relevant message using accurate event information.
- Messages remain editable.
- Nothing is sent without explicit approval.
- A fixed-versus-fixed conflict remains unresolved until explicit user action.
- The complete demonstration can be performed in under three minutes.

**Validation metrics (test with several working students if possible):** median time to resolve a shift-change scenario manually versus in ShiftSync; percentage of suggestions satisfying all constraints (target: 100% in test scenarios); percentage completing the flow without help; number of taps; and perceived usefulness. Record sample sizes and avoid presenting unmeasured improvements as facts.

## 11. Assumptions to validate

The project assumes that:

- Working students experience schedule conflicts frequently.
- Students want help reorganizing flexible plans.
- They prefer several suggestions over one automatic decision.
- They are comfortable connecting Google Calendar and Gmail.
- They will provide contact emails for fixed events.
- Explanations will make AI recommendations more trustworthy.
- Google integrations can be completed within the hackathon period.
- Working students value impact analysis and recovery planning more than a generic calendar.
- Students will accept shorter study blocks when continuous blocks are unavailable.

These assumptions should be tested with several working students before expanding the product.

## 12. Major risks

### Google integration complexity

Google OAuth, Calendar synchronization, and Gmail permissions may consume significant development time.

Recommendation: **investigate and configure OAuth early in parallel**, but design a fully functional local demonstration so the project does not depend on Google approval or connectivity.

### Incorrect AI-generated details

AI might produce the wrong time, recipient, or event information.

Recommendation: insert verified event data into a controlled message template. AI should improve the wording without changing factual details.

### Unreliable AI scheduling

Allowing AI to calculate schedules could create invalid recommendations.

Recommendation: use normal scheduling logic for overlaps and free-time calculations. Use AI only to explain the results.

### Duplicate calendar events

Improper synchronization could create duplicates.

Recommendation: store the Google Calendar event identifier and update the existing event instead of creating a new one.

### Excessive event-entry requirements

Too many fields may make the app inconvenient.

Recommendation: show only essential fields initially and reveal advanced options when needed.

### No feasible recovery slot

A student may have no valid time left before an exam or deadline. Never return invalid suggestions. Display a no-slot result, offer split sessions only if allowed, and recommend contacting the relevant person when necessary.

### Race conditions and external edits

Calendar availability may change after suggestions are generated. Revalidate on approval, use stored external IDs, and handle sync failures transparently. Never claim that remote updates succeeded without confirmation.

### Timezones and event recurrence

Use timezone-aware timestamps and clarify local date/time in the UI. Recurring-series exceptions can be deferred to post-MVP; avoid pretending that editing one occurrence always updates an entire series correctly.

## 13. Privacy and safety requirements

ShiftSync should:

- Use Google OAuth rather than requesting Google passwords.
- Request only the Calendar and Gmail permissions it needs.
- Clearly show what information will be accessed.
- Protect stored contact information.
- Never send messages without approval.
- Never change fixed events automatically.
- Clearly display every proposed calendar change.
- Allow users to disconnect their Google account.
- Keep AI API secrets and privileged database credentials on the backend only.
- Verify per-user ownership on every event/conflict API operation.
- Encrypt/protect OAuth tokens, request minimum scopes, and avoid logging sensitive tokens or student schedules.
- Provide usable local functionality when integrations are disconnected.
- Keep verified dates, times, recipient identity, and meeting details separate from AI-generated prose.

For Gmail, the safer MVP is to create a draft rather than send directly.

## 14. Features excluded from the MVP

The first version will not include:

- Automatic movement of work shifts or classes.
- Automatic email sending.
- Group-study scheduling across multiple accounts.
- Employer or university dashboards.
- Payroll or employee attendance features.
- Shift trading between employees.
- Automated negotiation with professors or employers.
- Support for calendar providers other than Google.
- Long-term schedule optimization.
- A fully autonomous AI agent.

These exclusions protect the hackathon’s scope.

## 15. Recommended direction

ShiftSync should be presented as a **one-tap schedule recovery assistant**, not as another calendar application.

Its strongest experience is:

> Detect the conflict, protect fixed commitments, recommend the best alternatives, update the calendar with approval, and prepare communication when rescheduling is impossible.

The scheduling system should be rule-based and reliable. AI should make the experience easier to understand and help students communicate. Students should retain control over every calendar change and outgoing message.

## 16. Signature innovation: Shift Impact Analysis

**Goal:** analyze the ripple effects of one changed shift across a student's schedule instead of reporting only one overlapping pair.

1. Capture the old and proposed new shift interval.
2. Retrieve events within the affected planning horizon (e.g., the next seven days).
3. Flag **direct overlaps** with the new shift.
4. Flag **buffer conflicts** caused by required travel or preparation time.
5. Model **knock-on impacts** introduced by candidate rescheduling plans; distinguish these from conflicts that already exist.
6. Group affected events by fixed/flexible status, deadline urgency, and priority.
7. Present a recovery plan and preview all proposed changes before approval.

**Illustrative example:** A shift moves from 1–5 PM to 8 AM–12 PM. Exam review from 9–11 AM is a direct overlap; an assignment block at 12 PM may violate a required travel buffer; an afternoon study session should be changed **only if** the chosen recovery plan would conflict with it.

**MVP boundary:** multi-event impact analysis and direct/buffer conflicts are essential. Automatic multi-event optimization is optional; in MVP, proposals may be sequential and user-approved.

## 17. Adaptive Study Recovery and unresolved conflicts

### Study recovery

- Search first for a continuous replacement of the original duration.
- If none exists and `splittable=true`, propose two or more smaller sessions meeting the total planned duration and deadline.
- Honor a configurable minimum block length and breaks.
- Never split a class, shift, or event marked unsplittable.
- If no valid recovery is possible, explain why and let the user keep the event unresolved.

### Resolution tracking

Use explicit states: `unresolved`, `draft_prepared`, `user_contacted`, `resolved`, `dismissed`. A draft alone does not imply an email was sent; `resolved` requires user action. Show unresolved issues on the Home screen.

## 18. Proposed technical architecture

**Suggested stack, subject to team familiarity and time constraints:**

| Layer | Proposed technology | Responsibilities |
|---|---|---|
| Mobile frontend | React Native + Expo + TypeScript | Android UI, navigation, event forms, alerts, approvals |
| Backend | Node.js + Express + TypeScript | Protected REST endpoints, user ownership checks, integrations |
| Database | Supabase PostgreSQL | Users, events, contacts, conflicts, suggestions |
| Authentication | Google OAuth (stretch) or local demo session | Identity; OAuth should not block local MVP demo |
| Scheduling engine | Pure TypeScript service | Conflict detection, interval search, scoring, revalidation |
| AI service | Server-side LLM API | Explanations and editable message wording only |
| Calendar | Google Calendar API (stretch) | Read events and patch linked event IDs |
| Email | Gmail API (stretch) | Create drafts after user approval; never auto-send |
| Collaboration | Git + GitHub | Version control, branch reviews, issue tracking |
| Android distribution | Expo EAS Build | APK build for demo/testing |

**Data flow:** React Native app → Express API → rule-based scheduler / AI message service → Supabase; optionally connect Google Calendar and Gmail through protected backend integration endpoints.

**Architecture rule:** every calendar decision is deterministic. The AI cannot change times, move fixed events, pick recipients, or approve/sync changes by itself. The app should remain functional when AI or Google APIs are unavailable.

## 19. Initial data model

Use a relational schema with these entities (names and columns are a starting contract):

| Table | Key fields | Notes |
|---|---|---|
| `users` | `id`, `email`, `display_name`, `timezone`, `preferences_json` | Privacy and study preferences |
| `events` | `id`, `user_id`, `title`, `category`, `start_at`, `end_at`, `is_fixed`, `priority`, `deadline_at`, `is_splittable`, `google_event_id` | Core schedule source; optional recurrence post-MVP |
| `conflicts` | `id`, `user_id`, `event_a_id`, `event_b_id`, `conflict_type`, `status`, `detected_at` | For direct/buffer conflicts; avoid duplicates |
| `suggestions` | `id`, `user_id`, `conflict_id`, `event_id`, `proposed_blocks_json`, `score`, `rank`, `status` | Proposed plan may contain one or several blocks |
| `contacts` | `id`, `user_id`, `name`, `email`, `role` | Optional employer/professor details |

**Integrity requirements:** `start_at < end_at`; every event belongs to a user; use timezone-aware instants (store UTC and IANA user timezone); enforce ownership checks and database row-level permissions as applicable. Store provider event identifiers to update rather than duplicate linked entries. Conflicts involving unsaved proposed shifts may be computed ephemerally until confirmed.

## 20. Initial API contract

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/events` | GET | Retrieve a user's events |
| `/api/events` | POST | Create an event |
| `/api/events/:id` | PATCH | Edit an event after permission checks |
| `/api/conflicts/analyze` | POST | Preview all impacts of a proposed shift change without committing it |
| `/api/suggestions` | POST | Generate validated candidate recovery plans |
| `/api/suggestions/:id/approve` | POST | Revalidate, persist, and optionally sync an approved change |
| `/api/ai/draft` | POST | Create editable message wording from verified event data |
| `/api/calendar/sync` | POST | Import/update connected calendar events (stretch) |

Use shared TypeScript request/response types and explicit errors such as `NO_FEASIBLE_SLOT`, `STALE_SUGGESTION`, `UNAUTHORIZED`, and `SYNC_FAILED`. Approval must be idempotent to avoid duplicated study blocks or remote events if a request is retried. Give the user clear feedback after a partial or failed synchronization.

## 21. Scheduling engine specification

### Hard constraints

- No overlap with fixed events or required buffer windows.
- No collision among proposed study blocks or other existing commitments.
- Proposed end times must occur before the deadline.
- Meet the original total duration unless the user explicitly changes the target.
- Respect the event's movable/splittable settings and the student's timezone.

### Algorithm

1. Accept a *proposed* shift change and an event snapshot.
2. Compute direct overlap and buffer-impact reports.
3. Identify affected flexible events and order recovery work by deadline urgency and priority.
4. Enumerate available candidate time windows inside a configurable planning horizon.
5. Validate hard constraints and total duration; if no full block fits, optionally generate split-block plans.
6. Score remaining candidates with adjustable weights (see §6); return at most three.
7. Before approval, refresh availability and reject stale/invalid suggestions.
8. Commit changes with safe retry/rollback behavior; sync to external calendar separately and surface failures.

### Edge-case test matrix

| Case | Expected behavior |
|---|---|
| Fixed shift vs. flexible study | Recommend valid moves, leave fixed event unchanged |
| Fixed shift vs. fixed class | No automatic move; draft contact message and track status |
| Two flexible events | Propose moving the lower-priority one; ask if tied |
| No full-length study slot | Offer allowed split plan or `NO_FEASIBLE_SLOT` |
| Deadline already passed | No fabricated recovery; show an explicit warning |
| Slot occupied before approval | Reject stale suggestion and recompute |
| Google offline / token expired | Preserve local workflow and report sync failure |
| Multiple impacted sessions | Preview each effect; ensure plans do not create new conflicts |
| Timezone transition / date boundary | Validate based on timezone-aware instants |
| Repeated approval request | Do not create duplicate events |

## 22. Three-person development workflow

**Developer 1 — Mobile UI/UX:** Expo setup; navigation; home, add-event, impact analysis, suggested times, communication, and preferences screens; UI integration against shared API mocks.

**Developer 2 — Scheduling + persistence:** Shared data models; deterministic time calculations; impact detection; slot generation/ranking; approval validation; Supabase schema and backend event APIs.

**Developer 3 — AI + external integrations:** AI prompts with verified facts; message editing; backend credential handling; Google OAuth/Calendar/Gmail integration and graceful offline/failure handling.

**Shared responsibilities:** API contracts, code review, integration testing, README, data seeding, APK packaging, pitch story, and live demonstration. Do not work in isolated branches for the entire hackathon; integrate small pieces frequently.

### Implementation phases / gates

1. **Define contracts and repo:** agree on event types, API formats, responsibility boundaries, and a seeded demo dataset.
2. **Build mock-first UI:** implement event display, proposed shift changes, and preview screens against mock JSON.
3. **Implement deterministic recovery:** conflict detection, impact report, candidate options, no-slot fallback, approvals, automated tests.
4. **Connect backend/database:** persist local data and ensure complete end-to-end recovery without outside APIs.
5. **Add AI messaging:** generate editable wording using verified structured details and safe fallback templates.
6. **Add Google services selectively:** complete OAuth and Calendar first; Gmail drafts next only if reliable.
7. **Demo hardening:** test on a real Android device, build APK, rehearse under three minutes, and keep a seeded offline/demo path.

**Priority order:** reliable core recovery > clear mobile UX > AI communication > Google Calendar > Gmail drafts > study splitting refinements > post-MVP features. Investigate Google permissions early but do not make the first demo milestone depend on them.

## 23. Validation and pitch plan

### Test the value proposition

Interview or observe several working students. Ask how often shifts change, what commitments are affected, how long recovery normally takes, and whether they prefer app-generated options. Run the same sample disruption manually and in ShiftSync, recording elapsed time, completion rate, taps, and errors. Report how many participants were tested; do not claim performance gains without measurements.

### Three-minute demo narrative

- **Problem (20–30 seconds):** sudden work shifts disrupt classes and study plans.
- **Trigger (20 seconds):** change a shift in a realistic existing schedule.
- **Impact (30 seconds):** show all direct and buffer conflicts in one view.
- **Recovery (60 seconds):** review up to three valid times, optionally show split-study fallback, and approve a plan.
- **Communication (30 seconds):** demonstrate a fixed/fixed overlap and an editable message.
- **Differentiation/closing (20–30 seconds):** explain deterministic scheduling, user control, and validated value.

### Main pitch

> Traditional calendars show working students when their schedules conflict. ShiftSync helps them recover. After an unexpected shift change, it analyzes the impact across their commitments, offers feasible study recovery plans, and supports communication when work and school cannot both be moved.

## 24. Post-MVP roadmap and scope controls

**MVP essentials:** manual shifts/events; multi-event impact report; fixed/flexible conflict detection; up to three valid recovery suggestions; explicit zero-slot state; approval and local persistence; editable AI or template-backed conflict messages.

**Hackathon stretch:** Google sign-in, Calendar synchronization, Gmail draft creation, adaptive split-study plans, richer conflict-status tracking.

**Post-MVP:** recurring exceptions, longer-term schedule optimization, proactive deadline planning, micro-study personalization, focus mode, app restrictions where operating-system permissions allow, multi-calendar providers, and accessibility/usability refinements.

**Explicit exclusions remain:** employer dashboards, automated negotiations, automatic email sending, movement of fixed events without approval, payroll, shift trades, and fully autonomous agents.

**Release gate:** never call the MVP complete unless its core demo works without AI/Google integrations, handles impossible schedules honestly, and updates only changes the student has reviewed.
