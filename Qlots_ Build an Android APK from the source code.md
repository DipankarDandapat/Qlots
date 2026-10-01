# Qlots: Build an Android APK from the source code

This guide explains how to build and test the Qlots Android app from the project source. It covers a **local APK build** and a simpler **Expo Application Services (EAS) cloud APK build**.

> **Important:** The Python API is a separate service. An APK contains the Android app, not the running backend or a production database. The test build also needs a reachable Qlots API. Do not use real financial information in this MVP.

## Choose a build route

| Route | Use it when | Output |
|---|---|---|
| Local Android SDK | You want to build on your computer and control the toolchain | Debug APK, or a release-variant test APK |
| EAS preview | You want Expo to build the APK in the cloud and have an Expo account | Internally distributable APK |
| EAS production | You are preparing a Play Store submission and have a production HTTPS API | Android App Bundle (`.aab`), **not** an APK |

For a quick installable test APK, use **EAS preview** if you are comfortable sending the selected project source to Expo's build service. Otherwise use the **local build** route.

## 1. Get the complete source

1. Download and extract the Qlots source ZIP.
2. Open a terminal in the extracted `qlots` project folder. The folders `backend/` and `mobile/` should be visible.
3. Install:
   - Node.js 22 and npm (the version used to validate this project).
   - Python 3.11 or later (needed to run the API, not to compile the Android APK).
   - For a local Android build, Android Studio/SDK and Java 21.

The source archive does not include `node_modules/` or the generated native `mobile/android/` folder; create those during the steps below.

## 2. Start the Python backend for testing

Keep the API running while you test features such as registration, records, projections and reports.

### Windows PowerShell

```powershell
cd qlots\backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### macOS or Linux

```bash
cd qlots/backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Leave this terminal open. On the same computer, verify the API by visiting `http://127.0.0.1:8000/docs`.

- Android Studio's standard Android emulator reaches the host computer at `http://10.0.2.2:8000`. That is the default API address in this Qlots app.
- A **physical phone** cannot usually use `10.0.2.2`. Set `EXPO_PUBLIC_API_URL` to the computer's reachable LAN address, such as `http://192.168.1.20:8000`, allow local network traffic through the computer firewall, and rebuild the app. Do this only on a trusted test network. A public/production app should use HTTPS.

## 3A. Build an APK locally (Android SDK)

### Install the Android build tools

Install Android Studio, then open **Tools → SDK Manager → SDK Tools** and **SDK Platforms**. This project was built with:

- Android SDK Platform **36** (`platforms;android-36`)
- Android SDK Build-Tools **36.0.0**
- Android NDK **27.1.12297006**
- CMake **3.22.1**
- Android SDK Platform-Tools
- Java / JDK **21**

In Android Studio's SDK Manager, enable **Show Package Details** if needed to select the exact NDK and CMake versions. Accept the Android SDK licenses when prompted. Ensure `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) points to the SDK directory and Java 21 is available to Gradle. Android Studio's bundled JDK can be selected under its Gradle JDK settings.

Common SDK directory locations:

- Windows: `%LOCALAPPDATA%\Android\Sdk`
- macOS: `$HOME/Library/Android/sdk`
- Linux: `$HOME/Android/Sdk` (or the location selected in Android Studio)

### Install JavaScript dependencies and generate Android project files

From the project root:

```bash
cd mobile
npm ci
npx expo-doctor
npx expo prebuild --platform android
```

`expo prebuild` generates `mobile/android/` from the Expo configuration. If you subsequently change native Expo plugins or native app configuration, run prebuild again and rebuild. Avoid `--clean` unless you intend to regenerate the native folder from scratch.

### Build a debug APK

From the `mobile` folder:

**Windows PowerShell:**
```powershell
cd android
.\gradlew.bat assembleDebug
```

**macOS or Linux:**
```bash
cd android
./gradlew assembleDebug
```

The APK is created at:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Install it into a running Android emulator with:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or copy that APK to a test device and install it there. Android may ask you to allow installation from that file manager/source. You do **not** need a phone to test: launch an Android Virtual Device from Android Studio's **Device Manager** and install the APK into that emulator instead.

### Optional: build the release variant as a test APK

This project’s generated Gradle release build is currently configured to use the **Android debug signing key**. It can make a release-variant APK for local testing, but it is **not a production-signed release** and must not be uploaded to Google Play.

From `mobile/android`:

**Windows PowerShell:**
```powershell
.\gradlew.bat assembleRelease
```

**macOS or Linux:**
```bash
./gradlew assembleRelease
```

Output:

```text
mobile/android/app/build/outputs/apk/release/app-release.apk
```

## 3B. Easier cloud build: EAS preview APK

EAS runs the Android build on Expo's build service. This project’s `preview` profile is configured to produce an APK.

1. Install Node.js/npm and open a terminal in `qlots/mobile`.
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Sign in to Expo or create an Expo account:
   ```bash
   npx eas-cli login
   ```
4. Build the preview APK:
   ```bash
   npx eas-cli build --platform android --profile preview
   ```
5. If EAS asks to configure the project or Android signing credentials, review its prompts and follow the setup flow. Wait for the cloud build to complete.
6. Download the APK from the build URL printed by EAS (or from the Expo dashboard's build page).

EAS preview builds are for internal testing. Verify the API URL used by the build and ensure your test device can reach that API. A local address such as `10.0.2.2` only works from an Android emulator on the same host; for a physical device, set the build-time environment variable to a reachable test API URL, for example:

**PowerShell:**
```powershell
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.20:8000"
npx eas-cli build --platform android --profile preview
```

**macOS/Linux:**
```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000 npx eas-cli build --platform android --profile preview
```

Replace the example address with your computer's actual LAN address. The phone and computer should be on the same trusted network, and the firewall must permit the connection. Plain HTTP is for local testing only.

> EAS is a cloud service: invoking this route uploads the project files selected by EAS to Expo to perform the build. Do not use this route if you are not authorized to send the project source to that service.

## 4. Test the app

Use a fresh test account and fictional values. Suggested checks:

1. Create an account (registration requires a password of at least 10 characters), sign out, then sign back in.
2. Add an asset and a liability; check that dashboard totals and net worth update.
3. Add monthly income and expenses; verify the cash-flow screen.
4. Change projection assumptions, recalculate, and compare conservative/base/optimistic scenarios.
5. Try the financial helper and generate/share a PDF report.
6. Delete a test record and check that it disappears after refresh.

If login fails, first confirm the backend terminal is still running and that `/docs` opens. Then check the API URL embedded in the app build, local firewall/network settings and backend terminal errors. An APK does not automatically start or host the Python backend.

## 5. Play Store build is different

Google Play normally accepts an **Android App Bundle (`.aab`)**, not the local test APK. This project’s `production` EAS profile is already configured for an App Bundle and sets `APP_ENV=production`, which disables Android cleartext HTTP.

Before making that build:

1. Deploy the Qlots API to a stable HTTPS address. Do not use `10.0.2.2` or an HTTP LAN address in the production app.
2. Set `EXPO_PUBLIC_API_URL` to that HTTPS API address.
3. Complete a security, privacy, data-safety and financial-calculation review; prepare the Play listing and policy materials.
4. Use protected production Android signing credentials. Keep upload keys and passwords private; do not commit them to source control.
5. Build the App Bundle:
   ```bash
   cd mobile
   npx eas-cli build --platform android --profile production
   ```
6. Download and verify the `.aab`, then upload it to an appropriate Play Console testing track. Public rollout is a separate release decision.

The EAS production profile builds an `.aab`, not an `.apk`. No Play Console upload or public release is performed by these commands.

## Troubleshooting

- **`SDK location not found`:** open Android Studio SDK Manager, confirm the SDK path, then set `ANDROID_HOME`/`ANDROID_SDK_ROOT` to that directory.
- **Gradle says the wrong Java version is active:** select JDK 21 as the Gradle JDK in Android Studio or set `JAVA_HOME` to JDK 21, then reopen the terminal.
- **CMake or NDK not found:** install the exact versions in the SDK Manager list above and rebuild.
- **Dependency download fails:** check internet access and run the Gradle command again; the first Android build downloads substantial Maven dependencies.
- **App opens but login/API calls fail:** confirm the backend is running and the app was built with the correct `EXPO_PUBLIC_API_URL`. The emulator host address and a phone's LAN address are different.
- **Release build rejected by Play Console:** the test APK is debug-signed. Create a properly production-signed `.aab` using the production release process instead.
