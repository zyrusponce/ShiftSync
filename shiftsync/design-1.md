# ShiftSync --- Mobile App Design Specification

## 1. Product Overview

**App name:** ShiftSync\
**AI assistant:** CalenBud\
**Platform:** Mobile app only\
**Primary font:** Poppins

ShiftSync is a mobile scheduling application that helps users organize
shifts, appointments, tasks, availability, and scheduling conflicts in
one place.

CalenBud is ShiftSync's built-in AI scheduling companion. CalenBud helps
users understand their schedule, identify conflicts, suggest better
times, and answer calendar-related questions.

The entire product should be designed specifically for **phone screens
and touch interaction**. Do not design desktop, laptop, tablet, or web
dashboard layouts.

### Brand personality

-   Calm
-   Helpful
-   Organized
-   Friendly
-   Smart
-   Reliable
-   Human-centered

The app should feel modern and polished without becoming overly
corporate or futuristic.

------------------------------------------------------------------------

# 2. Color System

  Role                    Color          Hex
  ----------------------- -------------- -----------
  Primary / Beige         Beige          `#C9B59D`
  Secondary / Deep Navy   Deep Navy      `#252E4B`
  Background              Warm Ivory     `#F5EBD8`
  Accent                  Teal           `#58A6AE`
  Accent Light            Light Aqua     `#89E3E5`
  Highlight               Golden Cream   `#F2C88E`
  Text / Dark             Near Black     `#080F20`

### Mobile usage

-   **Deep Navy `#252E4B`** --- primary text, headers, buttons, icons
-   **Warm Ivory `#F5EBD8`** --- primary app background
-   **Beige `#C9B59D`** --- secondary surfaces and muted controls
-   **Teal `#58A6AE`** --- primary actions, active navigation,
    interactive elements
-   **Light Aqua `#89E3E5`** --- CalenBud elements, selected states,
    information
-   **Golden Cream `#F2C88E`** --- reminders, important events,
    highlights
-   **Near Black `#080F20`** --- high-emphasis text

Use Warm Ivory, Deep Navy, Beige, and Teal as the dominant colors. Light
Aqua and Golden Cream should be accent colors.

------------------------------------------------------------------------

# 3. Typography

## Primary Font

Use **Poppins**.

Recommended weights:

-   400 --- body text
-   500 --- labels
-   600 --- buttons and card titles
-   700 --- page titles

If Poppins is unavailable, use **DM Sans** as the fallback.

### Mobile typography

-   Screen title: 24--28px, Bold
-   Section title: 18--20px, SemiBold
-   Card title: 15--17px, SemiBold
-   Body: 14--16px
-   Secondary text: 12--14px
-   Button text: 14--16px, SemiBold

Avoid excessively small text.

------------------------------------------------------------------------

# 4. Mobile UI Principles

The entire interface must be optimized for one-handed phone use.

### Layout

Use:

-   Single-column layouts
-   Full-width cards
-   Bottom navigation
-   Floating action buttons where appropriate
-   Bottom sheets instead of desktop-style side panels
-   Full-screen pages for complex forms
-   Large touch targets
-   Comfortable spacing

### Touch targets

Interactive elements should generally be at least **44 × 44 px**.

### Cards

Use rounded cards with:

-   12--18px radius
-   Soft shadows
-   Comfortable internal padding

### Avoid

-   Desktop sidebars
-   Multi-column dashboards
-   Tiny controls
-   Dense tables
-   Hover-dependent interactions
-   Desktop navigation
-   Small calendar controls
-   Excessive popups

------------------------------------------------------------------------

# 5. Mobile App Navigation

Use a persistent bottom navigation bar.

Recommended primary navigation:

``` text
┌──────────────────────────────────────────┐
│                                          │
│              Screen Content              │
│                                          │
├──────────────────────────────────────────┤
│  Home   Calendar   +   Conflicts   Shifts│
└──────────────────────────────────────────┘
```

### Bottom navigation

1.  **Home**
2.  **Calendar**
3.  **Add**
4.  **Conflicts**
5.  **Shifts**

The center `+` button should be visually prominent and use Teal.

Additional pages such as Availability, Tasks, Notifications, Profile,
and Settings should be accessed through the Home/Profile area.

### Active state

Use:

-   Teal icon
-   Teal label
-   Subtle Light Aqua background or indicator

------------------------------------------------------------------------

# 6. Splash Screen

Display the ShiftSync logo centered on a Warm Ivory background.

Example:

``` text
             ShiftSync

       Your schedule,
       perfectly in sync.

               ◌
```

Use a subtle loading animation.

Transition automatically to Login/Sign Up if the user is not
authenticated.

------------------------------------------------------------------------

# 7. Welcome / Landing Screen

Mobile-only onboarding-style landing screen.

### Layout

Top:

-   ShiftSync logo

Middle:

-   Simple calendar/scheduling illustration
-   CalenBud character

Headline:

> Your schedule, perfectly in sync.

Supporting text:

> Organize your shifts, events, tasks, and availability --- with a
> little help from CalenBud.

Bottom:

-   `Get Started`
-   `Log In`

Buttons should be full-width.

------------------------------------------------------------------------

# 8. Sign Up Screen

Use a single-column mobile layout.

### Header

Back button + ShiftSync logo.

### Content

Title:

> Create your account

Fields:

-   Full Name
-   Email
-   Password
-   Confirm Password

Optional:

-   Work / Organization

Checkbox:

> I agree to the Terms and Privacy Policy.

Primary button:

`Create Account`

Secondary:

`Continue with Google`

Bottom:

> Already have an account? **Log In here.**

Use keyboard-aware scrolling so fields are never hidden by the mobile
keyboard.

------------------------------------------------------------------------

# 9. Login Screen

### Content

Title:

> Welcome back

Subtitle:

> Let's get your schedule back in sync.

Fields:

-   Email
-   Password

Actions:

-   Show/hide password
-   Forgot password?

Primary:

`Log In`

Secondary:

`Continue with Google`

Bottom:

> Don't have an account? **Sign Up here.**

------------------------------------------------------------------------

# 10. Onboarding

After registration, use a short swipe/card-based setup.

## Step 1 --- About You

Question:

> How do you use ShiftSync?

Options:

-   Student
-   Employee
-   Manager
-   Freelancer
-   Other

## Step 2 --- Availability

Allow users to select:

-   Available days
-   Start time
-   End time
-   Days off

Use a mobile weekly schedule selector.

## Step 3 --- Preferences

Options:

-   Avoid overlapping events
-   Avoid back-to-back events
-   Prefer morning schedules
-   Prefer evening schedules
-   Add buffer time between events

## Step 4 --- CalenBud

Introduce CalenBud.

Example:

> Hi! I'm CalenBud 👋
>
> I'll help you keep your schedule organized and spot conflicts before
> they become problems.

CTA:

`Meet CalenBud`

Final CTA:

`Go to ShiftSync`

------------------------------------------------------------------------

# 11. Home Screen

The Home screen is the primary mobile dashboard.

## Header

Top row:

``` text
Good morning, [Name]       🔔
```

Optional profile avatar on the right.

Subtitle:

> Here's what's happening today.

## Today's Schedule

Display a vertically scrolling timeline.

Example:

``` text
TODAY

09:00 AM
Team Meeting
09:00 – 10:00 AM
Work

12:00 PM
Lunch
12:00 – 01:00 PM
Personal

02:00 PM
Work Shift
02:00 – 06:00 PM
Work
```

Cards should be easy to tap.

## Schedule Health

Compact horizontal cards:

``` text
8 Events       2 Conflicts
This Week      Need Attention
```

## Upcoming

Show the next 2--3 events.

## CalenBud Preview

A prominent card:

> Hi! I'm CalenBud.
>
> I noticed two events are close together tomorrow. Want me to check
> them?

Buttons:

`Check Schedule`

`Ask CalenBud`

## Quick Actions

Use horizontally scrollable action buttons:

-   Add Event
-   Add Shift
-   Add Task
-   Availability

------------------------------------------------------------------------

# 12. Calendar Screen

Calendar is a major mobile feature.

## Header

``` text
Calendar                 +
```

Controls:

-   Month
-   Week
-   Day

Keep controls compact.

## Month View

Use a mobile-friendly calendar grid.

Selected date should use Teal.

Dates containing events can show small indicators.

Example:

``` text
      October 2026

 M   T   W   T   F   S   S
             1   2   3   4
 5   6   7   8   9  10  11
12  13  14  15  16  17  18
19  20  21  22  23  24  25
26  27  28  29  30  31
```

## Selected Date

Below the calendar, show events for the selected day.

Example:

> Thursday, October 8

Then display event cards.

## Calendar filters

Bottom sheet options:

-   All
-   Work
-   Personal
-   Shifts
-   Tasks
-   Important

------------------------------------------------------------------------

# 13. Event Details Screen

Tapping a calendar event opens a full-screen details page.

Display:

-   Event title
-   Category
-   Date
-   Start time
-   End time
-   Location
-   Notes
-   Participants
-   Reminder
-   Repeat

Actions:

`Edit`

`Delete`

`Check for Conflicts`

Use a clear back button.

------------------------------------------------------------------------

# 14. Add Event Screen

Use a full-screen mobile form.

### Fields

-   Event title
-   Event type
-   Date
-   Start time
-   End time
-   Location
-   Notes
-   Repeat
-   Reminder

### Smart scheduling

Include:

> Let CalenBud help choose a time

When enabled, CalenBud checks the user's schedule and availability.

Bottom sticky button:

`Save Event`

------------------------------------------------------------------------

# 15. Add Menu

The center `+` button in the bottom navigation opens a bottom sheet.

Options:

``` text
What would you like to add?

📅 Event
🕐 Shift
✓ Task
🚫 Unavailable Time
```

Use large touch-friendly rows.

------------------------------------------------------------------------

# 16. Conflict Screen

The Conflict screen identifies scheduling issues.

### Header

> Schedule Conflicts

Subtitle:

> Let's get your schedule back in sync.

## Conflict Card

Example:

``` text
⚠ Potential Conflict

Work Shift
2:00 PM – 6:00 PM

Team Meeting
4:00 PM – 5:00 PM

These events overlap by 1 hour.

[Resolve Conflict]
```

### Conflict types

**High**

Direct overlap.

**Medium**

Very short gap between events.

**Low**

Potential issue based on user preferences.

## Actions

-   Resolve
-   Edit Event
-   Ignore

### AI action

Add:

`Ask CalenBud to Fix`

------------------------------------------------------------------------

# 17. Conflict Resolution Screen

When the user chooses to resolve a conflict, show CalenBud suggestions.

Example:

> I found 3 possible solutions.

### Option 1

**Move Team Meeting**

Thursday, 6:00 PM -- 7:00 PM

### Option 2

**Move Work Shift**

Friday, 2:00 PM -- 6:00 PM

### Option 3

**Keep Both**

Ignore the conflict.

Each option should have a clear button.

Do not automatically change the user's schedule.

------------------------------------------------------------------------

# 18. My Shifts Screen

Display work shifts in a mobile card list.

### Tabs

-   Upcoming
-   Open
-   Completed

### Shift Card

``` text
FRI, OCT 9

Work Shift
2:00 PM – 6:00 PM

Main Branch

Confirmed
```

Actions:

-   View
-   Edit
-   Request Swap
-   Cancel if permitted

------------------------------------------------------------------------

# 19. Shift Details

Full-screen shift details:

-   Date
-   Time
-   Position
-   Location
-   Notes
-   Status

Actions:

`Edit Shift`

`Request Swap`

`Add to Calendar`

------------------------------------------------------------------------

# 20. Availability Screen

Users define their available times.

### Weekly availability

Use expandable day rows.

Example:

``` text
Monday       8:00 AM – 6:00 PM
Tuesday      8:00 AM – 6:00 PM
Wednesday    Unavailable
Thursday     10:00 AM – 8:00 PM
Friday       8:00 AM – 5:00 PM
Saturday     Available
Sunday       Unavailable
```

Tap a day to open a time selector.

### Additional controls

-   Add unavailable date
-   Add preferred hours
-   Add scheduling restrictions

CalenBud uses this information when making suggestions.

------------------------------------------------------------------------

# 21. Tasks Screen

Use a simple mobile task manager.

### Tabs

-   Today
-   Upcoming
-   Completed

### Task card

``` text
Submit project report

Due Friday, 5:00 PM

HIGH PRIORITY
```

Actions:

-   Complete
-   Edit
-   Delete

Tasks can be connected to calendar events.

------------------------------------------------------------------------

# 22. CalenBud Chat Screen

CalenBud should have a dedicated full-screen chat experience.

## Header

``` text
←   CalenBud
    Your AI scheduling buddy
```

Include the CalenBud character avatar.

## Chat

Example:

**CalenBud**

> Hey! I checked your schedule and found two overlapping events
> tomorrow.

Buttons:

`Show Conflict`

`Find a Better Time`

`Ignore`

## User messages

Display user messages in Deep Navy bubbles.

## CalenBud messages

Display CalenBud messages on Light Aqua or Warm Ivory surfaces.

## Suggested prompts

At the bottom above the keyboard:

-   What's on my schedule today?
-   Find conflicts
-   When am I free?
-   Plan my week
-   Optimize my schedule

## Example requests

Users can ask:

> What do I have tomorrow?

> When am I free this week?

> Can I fit a meeting at 3 PM?

> What shifts do I have this weekend?

> Help me organize my week.

------------------------------------------------------------------------

# 23. CalenBud Floating Button

CalenBud should be accessible throughout the main app.

Use a floating circular button above the bottom navigation.

Character:

-   Small CalenBud face
-   Teal / Light Aqua
-   Deep Navy details

Tap opens the CalenBud chat.

The button can display a small notification dot when CalenBud has an
important scheduling suggestion.

------------------------------------------------------------------------

# 24. Notifications Screen

Display notifications as mobile cards.

Examples:

> Your work shift starts in 30 minutes.

> CalenBud found a possible conflict tomorrow at 3 PM.

> Your task "Submit report" is due tomorrow.

Categories:

-   Reminders
-   Conflicts
-   Shifts
-   Tasks
-   CalenBud

Use swipe gestures for:

-   Mark as read
-   Delete

------------------------------------------------------------------------

# 25. Profile Screen

Use a simple mobile profile page.

Top:

-   Profile avatar
-   Name
-   Email

Menu:

``` text
Personal Information
Connected Calendars
Notifications
AI Preferences
Appearance
Security
Help & Support
Log Out
```

Use large list rows with icons.

------------------------------------------------------------------------

# 26. Settings Screen

### Account

-   Personal information
-   Password
-   Security

### Calendar

-   Default calendar view
-   Week starts on
-   Default event duration
-   Time zone

### Notifications

-   Event reminders
-   Conflict alerts
-   Shift notifications
-   CalenBud suggestions

### AI Preferences

-   Enable CalenBud
-   Scheduling suggestions
-   Conflict resolution suggestions
-   AI notification frequency

### Appearance

-   Light
-   Dark
-   System

------------------------------------------------------------------------

# 27. Search

Include a global search screen accessible from Home or Calendar.

Users can search:

-   Events
-   Shifts
-   Tasks
-   Dates

Example:

> Search "meeting"

Results:

``` text
Team Meeting
Oct 9 • 4:00 PM

Project Meeting
Oct 12 • 2:00 PM
```

------------------------------------------------------------------------

# 28. Empty States

## Empty Calendar

> Your calendar is clear!

> You don't have any events scheduled yet.

Button:

`Add Your First Event`

## No Conflicts

> You're all in sync!

> No scheduling conflicts were found.

## No Tasks

> Nothing on your to-do list yet.

Button:

`Add Task`

## No Shifts

> No shifts scheduled.

Button:

`Add Shift`

------------------------------------------------------------------------

# 29. Loading States

Use lightweight skeleton loading rather than full-screen spinners where
possible.

For example:

``` text
████████████
████████
████████████████
```

Use subtle animation.

For CalenBud, use a small three-dot typing indicator.

------------------------------------------------------------------------

# 30. Error States

Errors should be friendly and actionable.

Example:

> Something went wrong.

> We couldn't load your calendar. Please try again.

Button:

`Try Again`

Avoid technical error messages.

------------------------------------------------------------------------

# 31. Mobile Gestures

Support natural mobile interactions where appropriate.

### Swipe

-   Swipe notification to dismiss
-   Swipe task to complete
-   Swipe calendar items where appropriate

### Tap

-   Tap event to view details
-   Tap date to change selected day
-   Tap CalenBud to open chat

### Long press

Can optionally be used for calendar events to reveal quick actions.

Do not make essential functionality dependent on gestures alone.

------------------------------------------------------------------------

# 32. Mobile Keyboard Behavior

All forms must be keyboard-aware.

When the keyboard appears:

-   Automatically scroll the active field into view
-   Keep the primary CTA accessible
-   Avoid content being hidden behind the keyboard
-   Allow the keyboard to dismiss by tapping outside fields

Chat should automatically move the conversation above the keyboard.

------------------------------------------------------------------------

# 33. Safe Areas

Support modern phone safe areas.

Respect:

-   Top status bar
-   Camera/notch areas
-   Home indicator area

Bottom navigation and floating buttons must never overlap the phone's
home indicator.

-----------------------------------------------------------------------

------------------------------------------------------------------------

# 35. CalenBud AI Principles

CalenBud should:

-   Be concise
-   Explain recommendations
-   Ask for confirmation before changing events
-   Never silently modify schedules
-   Clearly distinguish suggestions from confirmed events
-   Identify conflicts
-   Respect availability
-   Consider event duration
-   Consider existing commitments
-   Provide alternatives

### Example

Do not say:

> I moved your meeting.

Instead say:

> I found a better time for your meeting: Thursday at 3:00 PM. Would you
> like me to move it?

Buttons:

`Move Meeting`

`Keep Current Time`

------------------------------------------------------------------------

# 36. Calendar Event Colors

Use consistent category colors:

  Category              Color
  --------------------- ------------------------
  Work                  Teal `#58A6AE`
  Personal              Beige `#C9B59D`
  Important             Golden Cream `#F2C88E`
  CalenBud suggestion   Light Aqua `#89E3E5`
  Conflict              Deep Navy `#252E4B`

Never rely on color alone to communicate status. Include icons or
labels.

------------------------------------------------------------------------

# 37. Mobile Accessibility

Ensure:

-   High contrast
-   Large touch targets
-   Readable font sizes
-   Clear labels
-   Screen-reader-friendly controls
-   Visible focus states where applicable
-   Icons have accessible labels
-   Color is never the only status indicator
-   Important actions are easy to reach with one hand

------------------------------------------------------------------------

# 38. Motion

Animations should be subtle and fast.

Recommended:

-   150--250ms transitions
-   Bottom-sheet slide animations
-   Smooth page transitions
-   Small calendar selection animations
-   Gentle CalenBud idle animation
-   Typing indicator in chat

Avoid excessive animation.

------------------------------------------------------------------------

# 39. Mobile Information Architecture

``` text
ShiftSync
│
├── Home
│   ├── Today's Schedule
│   ├── Upcoming
│   ├── Schedule Health
│   ├── Quick Actions
│   └── CalenBud
│
├── Calendar
│   ├── Month
│   ├── Week
│   ├── Day
│   ├── Event Details
│   └── Add/Edit Event
│
├── Add
│   ├── Event
│   ├── Shift
│   ├── Task
│   └── Unavailable Time
│
├── Conflicts
│   ├── Conflict List
│   └── Conflict Resolution
│
├── My Shifts
│   ├── Upcoming
│   ├── Open
│   ├── Completed
│   └── Shift Details
│
├── CalenBud
│   └── AI Chat
│
├── Notifications
│
└── Profile
    ├── Availability
    ├── Tasks
    ├── Connected Calendars
    └── Settings
```

------------------------------------------------------------------------

# 40. Core Mobile User Flow

``` text
Splash
   ↓
Welcome
   ↓
Sign Up / Login
   ↓
Onboarding
   ↓
Home
   ↓
┌─────────────┬─────────────┬─────────────┬─────────────┐
│    Home     │  Calendar   │     +       │  Conflicts  │
└─────────────┴─────────────┴─────────────┴─────────────┘
                                           │
                                           ↓
                                    Resolve Conflict
                                           │
                                           ↓
                                       CalenBud

Calendar
   ↓
Event
   ↓
Event Details
   ↓
Edit / Delete / Check Conflict

+
   ↓
Add Event / Shift / Task / Unavailable Time

CalenBud
   ↓
AI Chat
   ↓
Suggestion
   ↓
User Confirmation
   ↓
Updated Schedule
```

------------------------------------------------------------------------

# 41. Mobile Design Tokens

``` text
--color-primary: #C9B59D;
--color-secondary: #252E4B;
--color-background: #F5EBD8;
--color-accent: #58A6AE;
--color-accent-light: #89E3E5;
--color-highlight: #F2C88E;
--color-text: #080F20;

--font-primary: "Poppins", sans-serif;

--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 18px;
--radius-pill: 999px;

--touch-target-min: 44px;

--transition-fast: 150ms;
--transition-normal: 250ms;
```

------------------------------------------------------------------------

# 42. Final Mobile Design Direction

ShiftSync should feel like a **warm, intelligent, mobile-first
scheduling companion**.

The visual identity combines:

-   Warm Ivory backgrounds
-   Deep Navy typography
-   Beige secondary surfaces
-   Teal primary actions
-   Light Aqua CalenBud accents
-   Golden Cream highlights
-   Poppins typography
-   Rounded cards
-   Simple mobile calendar interactions
-   Bottom navigation
-   Friendly CalenBud character

The app should never feel like a shrunken desktop website. Every screen
should be intentionally designed for phone use, touch interaction,
vertical scrolling, and quick one-handed actions.

### Core design principle

> **Make scheduling feel simple, calm, and manageable --- wherever the
> user is.**

CalenBud should reinforce this by acting as a friendly scheduling
companion that helps users understand, organize, and improve their
schedules without taking control away from them.
