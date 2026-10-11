# CALENBUD — FULL-STACK GEMINI AI MOBILE APP INTEGRATION

## ROLE

Act as a Senior React Native Developer, TypeScript Engineer, AI Engineer, Backend Architect, and Mobile Application Developer.

Your task is to transform my existing **Calenbud mobile application** into a fully functional AI-powered scheduling assistant for working college students.

## IMPORTANT PROJECT INFORMATION

- Application name: Calenbud
- Platform: Android mobile application
- Frontend: React Native + TypeScript
- Development framework: Expo
- Mobile deployment: Expo Application Services (EAS)
- AI provider: Google Gemini API via Google AI Studio
- Backend: TypeScript
- Database: Supabase PostgreSQL
- Authentication: Supabase Auth
- API credentials: Already stored in `.env`

**CRITICAL: I ALREADY HAVE THE FRONTEND.**

Do not recreate, redesign, or replace my existing mobile frontend.

Preserve the current UI, colors, themes, typography, animations, layouts, navigation, and responsiveness.

Your primary task is to make the existing application fully functional by integrating real backend services, Gemini AI, database operations, and mobile-compatible features.

---

# 1. PROJECT INSPECTION

Before implementing anything, thoroughly inspect the existing codebase.

Identify:

- Expo SDK version
- React Native version
- TypeScript configuration
- Existing project structure
- Expo Router or React Navigation configuration
- Existing calendar interface
- AI chatbot interface
- Work shift management screens
- Task management screens
- Dashboard
- Existing state management
- Existing API services
- Environment variable names
- Existing authentication system
- Existing database integrations
- Installed dependencies

Determine which features already work and which use placeholder functionality.

Do not duplicate existing working functionality.

Do not migrate the frontend to React for web or introduce browser-specific libraries.

All frontend code must remain compatible with React Native and Expo.

# 2. TECHNOLOGY STACK

Use the following technologies where compatible with the existing codebase.

### Mobile Frontend
- React Native
- TypeScript
- Expo
- Expo Router or existing navigation library
- Existing styling and UI components

### Backend
- Node.js
- Express.js
- TypeScript
- Zod validation
- REST APIs

Alternatively, use Supabase Edge Functions if they fit the existing architecture better.

### AI
- Google Gemini API
- Google AI Studio
- Official `@google/genai` SDK
- Gemini function calling
- Structured AI responses

### Database
- Supabase PostgreSQL
- Supabase Row Level Security
- Supabase Auth

### Mobile Development and Deployment
- Expo CLI
- Expo Go for compatible development workflows
- Expo development builds when native functionality requires them
- Expo Application Services (EAS Build)
- Android APK for direct installation and testing
- Android AAB for potential Play Store distribution

Do not use Vercel as the mobile app deployment method.

Deploy the mobile application using Expo EAS Build.

Host backend API services separately when required.

# 3. EXISTING ENVIRONMENT VARIABLES

All existing API keys and credentials have already been stored in `.env`.

Instructions:

1. Inspect existing environment variable names.
2. Reuse configured API credentials.
3. Do not create duplicate environment variables unnecessarily.
4. Do not replace or overwrite existing credentials.
5. Never hardcode secret keys.
6. Keep Gemini API keys on the backend.
7. Keep Supabase service-role credentials on the backend.
8. Use `EXPO_PUBLIC_` only for configuration values safe to expose in the compiled mobile app.
9. Do not expose secret keys through Expo application configuration.
10. Ensure `.env` and other private configuration files are excluded from Git commits.
11. Use EAS environment configuration for cloud builds without exposing sensitive values.
12. Validate required configuration without printing secrets.

Important:

Environment variables included in the compiled mobile application can be inspected by users.

The Gemini API key must never be bundled into the APK.

If existing credentials are currently exposed to the mobile bundle, relocate their use to secure backend code.

If additional configuration is required, report the missing variable name without requesting its secret value.

# 4. CORE FEATURE — ADAPTIVE SMART SCHEDULING

Implement an intelligent scheduling system that analyzes students' real schedules.

The system must:

- Retrieve class schedules.
- Retrieve work shifts.
- Retrieve academic deadlines.
- Retrieve personal commitments.
- Identify available time slots.
- Prioritize assignments by urgency and importance.
- Consider estimated task duration.
- Recommend practical study periods.
- Respect fixed commitments and unavailable periods.
- Avoid scheduling conflicts.
- Recalculate recommendations after relevant changes.

Use deterministic TypeScript scheduling logic for time calculations and conflict checking.

Use Gemini to interpret user intentions, explain recommendations, and rank valid scheduling alternatives.

# 5. CORE FEATURE — SHIFT CHANGE RESCHEDULING

Implement intelligent rescheduling for working students.

When a student changes a work shift:

1. Retrieve the original shift.
2. Validate the new shift.
3. Retrieve existing calendar events.
4. Identify affected activities.
5. Detect scheduling conflicts.
6. Separate fixed commitments from flexible activities.
7. Calculate available replacement slots.
8. Send valid alternatives to Gemini for analysis.
9. Generate an intelligent rescheduling proposal.
10. Display the proposal in the existing mobile UI.
11. Allow the student to approve or reject the proposal.
12. Revalidate all changes after approval.
13. Save changes to Supabase.
14. Refresh the mobile calendar.
15. Display success only after persistence is confirmed.

Never automatically modify unrelated events.

If no suitable replacement exists, explain why and provide available alternatives.

# 6. CORE FEATURE — INTELLIGENT CONFLICT DETECTION

Implement a reliable conflict detection engine.

Detect overlaps between:

- Class schedules
- Work shifts
- Study sessions
- Personal commitments
- Assignment work blocks
- Calendar events

Each detected conflict must include:

- Conflicting event identifiers
- Event titles
- Original schedule
- Conflicting time period
- Explanation
- Suggested alternatives

Handle:

- Overnight shifts
- Adjacent events
- Different timezones
- Recurring commitments
- Invalid date ranges

Mathematical conflict detection must be performed by TypeScript backend logic.

Gemini should explain the results and recommend solutions.

# 7. CORE FEATURE — MICRO-STUDY RECOMMENDATIONS

Develop personalized study recommendations using available time slots.

Requirements:

- Identify free time between existing activities.
- Analyze upcoming assignments.
- Consider deadlines and task priorities.
- Recommend short, realistic study sessions.
- Match study recommendations to relevant subjects or tasks.
- Avoid fixed commitments.
- Respect user scheduling preferences.
- Allow students to accept, edit, or reject recommendations.

Example:

"You have 25 minutes available before your next class. Would you like to review your Java notes?"

Recommendations must be generated using actual user data.

# 8. CORE FEATURE — GEMINI AI ASSISTANT

Connect the existing Calenbud chatbot interface to a working Gemini AI backend.

The AI assistant must understand natural-language requests and have access to relevant, authenticated scheduling information through secure backend tools.

### AI Capabilities

- Answer questions about today's schedule.
- Identify upcoming classes.
- Identify work shifts.
- Explain upcoming deadlines.
- Detect scheduling conflicts.
- Find available study periods.
- Recommend task priorities.
- Generate study schedules.
- Propose event creation.
- Propose event modifications.
- Help students reschedule flexible commitments.

### Example

User:

"Calenbud, my work shift changed to 4 PM tomorrow. Can you adjust my study schedule?"

Expected process:

1. Understand the requested change.
2. Retrieve actual schedule information.
3. Resolve the correct date and timezone.
4. Identify affected events.
5. Detect conflicts.
6. Find available alternatives.
7. Generate an AI recommendation.
8. Present proposed changes in the UI.
9. Request approval.
10. Execute approved changes using backend functions.
11. Verify database persistence.
12. Refresh the calendar.

Never use hardcoded or fabricated scheduling information as if it were real user data.

### Gemini System Instruction

You are Calenbud, a helpful AI scheduling assistant for working college students.

Your purpose is to help students balance their academic activities, work shifts, assignments, deadlines, and personal commitments.

Use authenticated, real scheduling information whenever making personalized recommendations.

Prioritize fixed commitments, academic deadlines, and realistic study schedules.

Never invent user events or deadlines.

Always check scheduling constraints using the provided tools.

Never modify stored data without explicit user approval.

Never report that a change was successful unless the backend confirms it.

Keep responses concise, friendly, and easy to understand.

# 9. AI FUNCTION CALLING

Implement Gemini function calling using validated TypeScript backend functions.

### Read Operations
- `getUserSchedule`
- `getUpcomingEvents`
- `getWorkShifts`
- `getAssignments`
- `getTasks`
- `detectConflicts`
- `findAvailableSlots`

### Recommendation Operations
- `suggestStudySessions`
- `generateScheduleProposal`
- `proposeReschedule`
- `recommendTaskPriority`

### Write Operations
- `createCalendarEvent`
- `updateCalendarEvent`
- `deleteCalendarEvent`
- `createTask`
- `updateTask`
- `markTaskComplete`

All write operations require explicit confirmation.

Validate tool parameters using Zod.

Authenticate every request and enforce data ownership.

Gemini must never receive database secrets or unrestricted database access.

# 10. MOBILE CALENDAR MANAGEMENT

Make the existing mobile calendar fully functional.

Requirements:

- Create calendar events.
- Edit events.
- Delete events with confirmation.
- Display daily schedules.
- Display weekly schedules.
- Display monthly schedules.
- Categorize events.
- Display event information.
- Save events to Supabase.
- Refresh the UI after changes.
- Display conflict warnings.
- Support recurring events where already implemented or required.

Use React Native-compatible components.

Ensure calendar interactions are touch-friendly.

Preserve the existing calendar design.

# 11. WORK SHIFT MANAGEMENT

Implement:

- Adding work shifts
- Editing work shifts
- Deleting shifts with confirmation
- Viewing upcoming shifts
- Detecting shift changes
- Identifying conflicts
- Generating rescheduling proposals

Shift changes should trigger scheduling analysis.

Changes affecting other activities must require approval.

# 12. TASK AND ASSIGNMENT MANAGEMENT

Implement:

- Create tasks
- Edit tasks
- Delete tasks with confirmation
- Set deadlines
- Set priorities
- Estimate task durations
- Mark tasks complete
- Identify overdue tasks
- Display upcoming deadlines
- Filter tasks
- Persist task information in Supabase

Connect task data to the adaptive scheduling engine.

# 13. DATABASE AND AUTHENTICATION

Use Supabase PostgreSQL unless an appropriate database already exists.

Create or reuse tables for:

- User profiles
- Calendar events
- Class schedules
- Work shifts
- Assignments
- Tasks
- Scheduling preferences
- Scheduling proposals
- AI action approvals

Implement:

- Appropriate primary and foreign keys
- Data validation
- Database migrations
- User ownership
- Row Level Security
- Secure authenticated access
- Persistent data storage
- Transactions for multi-event changes

Use Supabase Auth with the existing authentication interface.

Configure mobile-compatible session persistence using appropriate secure storage mechanisms.

Protect all user data.

# 14. GOOGLE CALENDAR INTEGRATION

Implement Google Calendar synchronization when the required OAuth configuration is available.

Requirements:

- Google OAuth 2.0
- Expo-compatible authentication flow
- Secure token handling
- Mobile deep linking
- Reading authorized events
- Importing calendar information
- Synchronizing approved changes
- Preventing duplicate events
- Handling revoked permissions
- Handling expired sessions

Use appropriate Expo AuthSession functionality or an existing compatible authentication solution.

Do not embed Google OAuth client secrets in the mobile app.

Ensure the Calenbud calendar works without a connected Google account.

# 15. MOBILE FRONTEND INTEGRATION

Preserve all existing React Native TypeScript screens.

Inspect and connect:

- Dashboard
- Calendar
- Work shifts
- Task manager
- AI chatbot
- Settings
- Authentication

Replace placeholder functions with real operations.

Use typed services and API responses.

Implement:

- Loading indicators
- Error messages
- Confirmation dialogs
- Success feedback
- Data refresh after mutations
- Safe handling of offline or interrupted requests
- Mobile-friendly user interactions

Avoid browser-only APIs.

Do not replace React Native components with HTML elements.

# 16. RECOMMENDED APPLICATION ARCHITECTURE

Follow this architecture:

**Expo React Native App**
- Renders the existing UI
- Handles user interaction
- Displays schedules and tasks
- Sends authenticated requests
- Shows AI proposals and confirmations

**TypeScript Backend**
- Verifies authentication
- Retrieves relevant user data
- Calls Gemini securely
- Implements scheduling algorithms
- Validates AI-generated actions
- Executes approved database changes

**Gemini API**
- Interprets user requests
- Explains schedule conflicts
- Ranks available options
- Generates personalized recommendations
- Proposes scheduling actions

**Supabase**
- Stores users
- Stores events
- Stores shifts
- Stores tasks
- Stores scheduling proposals
- Enforces data permissions

The mobile application must never call Gemini using an embedded private API key.

# 17. SECURITY AND RELIABILITY

Implement:

- Secure backend environment variables
- Authenticated API endpoints
- Row Level Security
- Request validation
- Rate limiting
- AI function-call validation
- Event ownership verification
- Scheduling conflict revalidation
- Duplicate-operation prevention
- Secure session storage
- Error handling
- Timezone-safe scheduling
- Protection against prompt injection

Handle Gemini service failures without losing existing schedule data.

# 18. EXPO MOBILE DEVELOPMENT

Ensure the application works correctly in the existing Expo project.

Requirements:

1. Preserve the current Expo configuration.
2. Use compatible Expo and React Native dependencies.
3. Do not introduce unsupported native modules.
4. Verify compatibility with the installed Expo SDK.
5. Maintain TypeScript compatibility.
6. Support Android devices.
7. Preserve mobile navigation.
8. Handle safe areas and touch interactions.
9. Ensure the backend API can be accessed from physical mobile devices.
10. Do not use `localhost` as the backend address on a physical Android device unless a suitable forwarding mechanism exists.

Use an appropriate development API URL and a deployed HTTPS backend URL for release builds.

# 19. EXPO EAS BUILD AND DEPLOYMENT

Prepare the application for Android deployment through Expo Application Services.

Inspect and configure:

- `app.json` or `app.config.ts`
- `eas.json`
- Android application identifier
- Required application permissions
- App icons and splash screen
- Build environments
- API endpoint configuration
- Deep-linking configuration

Create appropriate build profiles:

### Development
Used for development and native feature testing.

### Preview
Generate an installable Android APK for hackathon demonstrations and testing.

### Production
Generate an Android App Bundle (AAB) for potential Play Store distribution.

Ensure the APK communicates with the deployed backend and Supabase.

Do not assume that Expo EAS Build automatically deploys the backend.

Document how to build, install, and test the final APK.

# 20. TESTING REQUIREMENTS

Test the application using realistic scenarios.

### Test 1 — Calendar Event Creation
Create an event and verify that it persists after closing and reopening the app.

### Test 2 — Work Shift Change
Modify a work shift and verify that affected commitments are analyzed.

### Test 3 — Conflict Detection
Create overlapping commitments and confirm that conflicts are detected accurately.

### Test 4 — Gemini Scheduling
Ask the chatbot to recommend a study session using the user's actual schedule.

### Test 5 — Rescheduling Proposal
Request a new study time and verify that Gemini proposes a valid alternative.

### Test 6 — User Approval
Approve the proposal and verify that the database and calendar update.

### Test 7 — Proposal Rejection
Reject a proposal and verify that no schedule changes are saved.

### Test 8 — Micro-Study Recommendation
Verify that suggestions fit actual free time.

### Test 9 — API Failure
Simulate AI unavailability and verify that existing calendar functions continue working.

### Test 10 — Android Device
Install an EAS preview APK on a physical Android device and verify that authentication, database operations, calendar interactions, and Gemini requests function correctly.

### Test 11 — Authorization
Verify that one authenticated user cannot access or modify another user's schedule.

Do not report a test as passed unless it actually executed successfully.

# 21. IMPLEMENTATION ROADMAP

Follow this order:

**Phase 1 — Inspection**
- Inspect the existing Expo + TypeScript project.
- Identify working and incomplete features.
- Inspect environment variable names safely.

**Phase 2 — Backend**
- Configure TypeScript backend services.
- Connect the existing Gemini API key.
- Add validation and authentication.

**Phase 3 — Supabase**
- Configure or reuse database tables.
- Implement persistence.
- Enable Row Level Security.

**Phase 4 — Scheduling Engine**
- Implement calendar CRUD.
- Implement work shift management.
- Implement conflict detection.
- Implement available-slot calculations.

**Phase 5 — Gemini Integration**
- Connect the existing chatbot.
- Implement tool calling.
- Implement AI scheduling proposals.
- Implement approval-based updates.

**Phase 6 — Intelligent Features**
- Adaptive smart scheduling
- Shift change rescheduling
- Intelligent conflict detection
- Micro-study recommendations

**Phase 7 — Expo Frontend Integration**
- Connect existing screens to APIs.
- Integrate real scheduling data.
- Implement confirmation workflows.
- Verify navigation and UI updates.

**Phase 8 — Testing**
- Run TypeScript checks.
- Run unit tests.
- Run backend tests.
- Verify complete scheduling workflows.
- Test on an Android device.

**Phase 9 — Android Build**
- Configure EAS.
- Build an Android preview APK.
- Verify connectivity to the deployed backend.
- Test the installed APK.
- Document remaining deployment requirements.

# 22. SUCCESS CRITERIA

Calenbud is considered functional when:

1. The existing React Native TypeScript frontend is preserved.
2. Users can create and manage calendar events.
3. Work shifts are saved persistently.
4. Tasks and deadlines are managed correctly.
5. Gemini accesses actual authenticated scheduling data.
6. Scheduling conflicts are detected accurately.
7. Study recommendations are based on valid available periods.
8. Shift changes generate intelligent rescheduling proposals.
9. Students can approve or reject AI suggestions.
10. Approved changes persist in Supabase.
11. The mobile UI refreshes correctly.
12. API credentials remain secure.
13. The application works on a physical Android device.
14. A functional APK can be generated using Expo EAS Build.

# FINAL INSTRUCTION

I already have an existing Calenbud mobile frontend developed using React Native, TypeScript, and Expo.

All existing API credentials are stored in `.env`.

Do not generate a new frontend.

Preserve the existing design and integrate fully functional backend services, database operations, and Gemini AI capabilities.

Use TypeScript across the mobile frontend and backend.

Implement actual functionality rather than mock responses.

Work directly with the existing source code, test each major feature, and fix errors.

Do not stop at creating a development plan.

If credentials, external services, or permissions prevent completion, identify the exact blocker without exposing secret values.

Prepare the project for deployment through Expo EAS Build.

**PRIMARY HACKATHON DEMONSTRATION:**

Student Changes Work Shift → Calenbud Detects Scheduling Conflict → Gemini Analyzes Available Time → AI Recommends a New Schedule → Student Approves → Backend Saves Changes → Mobile Calendar Updates

**FINAL GOAL: A fully functional, Gemini-powered Calenbud mobile application, built with React Native + TypeScript, packaged as an installable Android APK through Expo.**