# ShiftSync
<<<<<<< HEAD

A phone-only React Native app built with TypeScript and Expo, following [the supplied design specification](../design-1.md).

## Preview without Android Studio

Install [Expo Go for SDK 57](https://expo.dev/go?sdkVersion=57&platform=android&device=true) on your Android phone. Connect the phone and computer to the same Wi-Fi network, then run:

```powershell
cd shiftsync
npm run start:go
```

Open Expo Go and scan the terminal's QR code. This previews the app without installing an Android SDK or compiling a native build. The app's current native libraries are supported by Expo Go. If your network prevents a LAN connection, try `npx expo start --go --tunnel` and accept the prompt to install the tunnel dependency if it appears.

## Run on Android

Node.js 24 LTS and npm are required. Dependencies are already installed in this workspace; a fresh checkout needs `npm install`.

```powershell
cd shiftsync
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
- Event forms and details: title, category, date/time, location, notes, participants, recurrence, reminders, priorities and shift status; edit and confirmed deletion.
- Conflicts: exact overlaps, short gaps and availability issues; alternative times require explicit confirmation.
- Shifts: upcoming, open and completed; local swap requests and cancellation.
- Tasks: due, upcoming and completed; checkbox and swipe completion.
- Availability: editable weekly hours, days off, preferred hours, restrictions and blocked dates.
- CalenBud: local schedule questions, conflicts and available-hour suggestions; never silently changes events.
- Notifications: local schedule notices, swipe read/delete, and accessible action buttons.
- Profile: editable details, calendar connection information, settings, light/dark/system appearance, and logout.

Example data uses dates relative to the first launch rather than hard-coded dates. Schedule and preferences persist on the device. Calendar times use the phone's local time zone. Overnight shifts should be entered as two items, one on each day.

## Service boundaries

This build is a functional local demo. Profile forms do not create or authenticate online accounts, and passwords are never stored. Google/Microsoft sign-in, connected calendars, remote shift swaps, push delivery, cloud backup and AI inference require separately configured services. Relevant screens explain this before a user tries those actions.

CalenBud answers using the actual local schedule and deterministic scheduling rules; it is not connected to an AI model. Its available-hour suggestions consider availability, blocked time, event duration and buffer settings.

Recurring conflict resolution moves just the selected occurrence and preserves the rest of the series. Editing a recurring item from its details changes the whole series. Recurring suggestions and save warnings check a 14-day horizon; conflicts farther into the future may appear when they enter that horizon. Recurring shift lists show the next two weeks or the previous 30 days, with the correct occurrence dates.

## Verify

```powershell
npm run typecheck
npm test
npm run export:native
npx expo install --check
```

Native bundle export verifies Metro compilation for Android and iOS. It does not produce an APK/IPA or prove device behavior. Review keyboard, screen-reader, swipe and safe-area behavior on physical devices before release.

Verified in this workspace: TypeScript passed; all 26 scheduling, persistence and assistant tests passed; all 21 Expo Doctor checks passed; Prettier checks passed; Android and iOS Hermes bundle exports passed. An independent source review identified six material issues, which were corrected; regression tests cover the scheduling and persistence fixes.

The dependency audit reports 23 inherited advisories (16 high, 7 moderate), primarily through the Expo/Metro toolchain, `node-forge`, `braces`, and `xcode`'s `uuid`. Compatible `npm audit fix` updates were applied. npm's remaining proposed fixes downgrade Expo/React Native across major versions, so they were not forced. Recheck upstream patches before shipping; this is not a clean security audit.

## Source layout

`src/domain/` contains pure scheduling functions, types and sample data. `src/store/` owns local persistence. `src/components/` contains themed controls and calendar item cards. `src/screens/` groups the mobile features, and `src/navigation/` defines the typed stack and five-action tab bar. Poppins is bundled locally for offline use.
=======
ShiftSync is an AI-powered time management app for working college students that coordinates work shifts, class schedules, deadlines, and study time. It automatically detects conflicts, adjusts study sessions when schedules change, recommends productive use of short free periods, and supports focused study through Focus Mode.
>>>>>>> 9419ad37d5404d3358ce08d1d57cb7277931e240
