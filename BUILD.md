# Android Build Guide — RoboPet

This guide explains how to build an Android APK for the RoboPet app. The app runs entirely on-device — all logic (speech recognition, chat, TTS) lives inside the Ionic/Angular WebView with no backend server required.

---

## Architecture Overview

```
┌──────────────────────────────────────────────┐
│                 Android APK                   │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │           Ionic / Angular WebView       │  │
│  │                                        │  │
│  │  GigaAmService  — STT via ONNX        │  │
│  │  (onnxruntime-web, runs locally)  │  │
│  │                                        │  │
│  │  NativeSpeechService — Web Speech API  │  │
│  │  (window.SpeechRecognition, online)    │  │
│  │                                        │  │
│  │  ChatService  — keyword-based chat     │  │
│  │  (en / ru, no network required)        │  │
│  │                                        │  │
│  │  EmotionService  — animated robot face │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Capacitor plugins:                          │
│  - Voice Recorder  (microphone input)        │
│  - Text-to-Speech  (voice output)            │
│  - Camera Preview  (viewfinder)              │
│  - Speech Recognition  (native STT)          │
└──────────────────────────────────────────────┘
```

### STT modes

The app supports three voice recognition modes, selectable in **Settings → Voice recognition mode**:

| Mode | Service | Internet required | Notes |
|------|---------|:-----------------:|-------|
| `gigaam` | `GigaAmService` (`onnxruntime-web`) | Only on download button | Default. RU v3 and EN Multilingual models (~225 MB each), downloaded by button and stored in IndexedDB; offline afterwards |
| `native` | `NativeSpeechService` (Web Speech API) | Yes | Uses `window.SpeechRecognition` inside the WebView — Android/Chrome routes audio to Google servers |
| `capacitor` | `CapacitorSpeechService` (`@capacitor-community/speech-recognition`) | Usually yes | Uses the native Android `SpeechRecognizer` directly; can work offline on Android 13+ if an offline language pack is installed under Settings → Language → Offline speech recognition |

### Voice flow (GigaAM mode)

1. User holds the mic button → `capacitor-voice-recorder` captures audio.
2. On release → `GigaAmService.transcribe()` resamples audio to 16 kHz and runs GigaAM ONNX inference locally in the WebView.
3. The recognised text goes to `ChatService.processMessage()` — TypeScript keyword matching, or the configured LLM API.
4. `ChatService` emits a `RobotResponse` with text and emotion; the robot face animates and TTS speaks the reply.

### Voice flow (native / capacitor modes)

1. User holds the mic button → recognition starts immediately (no audio buffering).
2. On release → `stopListening()` is called; the in-flight promise resolves with the final transcript.
3. Steps 3–4 are identical to GigaAM mode above.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 22 LTS | `node --version` |
| npm | ≥ 10 | bundled with Node |
| Ionic CLI | ≥ 7 | `npm i -g @ionic/cli` |
| Angular CLI | ≥ 20 | installed locally via npm |
| Java JDK | 17 or **21** | `java -version`; required by Android Gradle. **Java 22+ is not supported by Gradle 8.x** — see [Troubleshooting](#troubleshooting) |
| Android Studio | Hedgehog+ (2023.1+) | includes SDK, emulator |
| Android SDK | API 36 (target) | install via SDK Manager |
| Git | any | |

> **Android SDK environment variables** — add these to your shell profile:
> ```bash
> export ANDROID_HOME=$HOME/Android/Sdk
> export PATH=$PATH:$ANDROID_HOME/tools:$ANDROID_HOME/platform-tools
> ```

---

## Step 1 — Clone and install dependencies

```bash
git clone <repo-url> robopet
cd robopet/mobile
npm install
```

---

## Step 2 — Build the web assets

```bash
npm run build
```

Both commands output compiled assets to `mobile/www/`. Verify:

```bash
ls www/
# Should contain: index.html, main.*.js, polyfills.*.js, styles.*.css, assets/, ...
```

---

## Step 3 — Add the Android Capacitor platform

```bash
# Only needed once per checkout
npx cap add android

# Sync web assets and plugins into the android/ project
npx cap sync android
```

This creates `mobile/android/` — a standard Android Gradle project that Android Studio can open directly.

---

## Step 4 — Add required Android permissions

Edit `mobile/android/app/src/main/AndroidManifest.xml` and ensure these permissions are present:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.INTERNET" />
```

> The `INTERNET` permission is required by the `native` and `capacitor` STT modes (both route audio to Google Speech servers by default). It is also needed on manual model download in `gigaam` mode to download the model from Hugging Face CDN.

---

## Step 5 — Build the APK

### Debug build (for testing)

```bash
cd mobile/android
./gradlew assembleDebug
```

Output:

```
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

### Release build (for distribution)

1. Generate a signing keystore (one-time):
   ```bash
   keytool -genkey -v \
     -keystore robopet-release.jks \
     -alias robopet \
     -keyalg RSA -keysize 2048 \
     -validity 10000
   ```

2. Add signing config to `mobile/android/app/build.gradle`:
   ```groovy
   android {
       signingConfigs {
           release {
               storeFile file("../robopet-release.jks")
               storePassword System.getenv("KEYSTORE_PASSWORD")
               keyAlias "robopet"
               keyPassword System.getenv("KEY_PASSWORD")
           }
       }
       buildTypes {
           release {
               signingConfig signingConfigs.release
               minifyEnabled false
           }
       }
   }
   ```

3. Build:
   ```bash
   cd mobile/android
   KEYSTORE_PASSWORD=<your-pass> KEY_PASSWORD=<your-pass> \
     ./gradlew assembleRelease
   ```

   Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`

---

## Step 6 — Install and run on a device

Connect your Android device with **USB debugging** enabled, or start an emulator (x86_64 AVD).

```bash
# Check connected devices
adb devices

# Install the debug APK
adb install mobile/android/app/build/outputs/apk/debug/app-debug.apk

# Stream logs
adb logcat -s "Capacitor"
```

You can also open the project directly in Android Studio and use **Run ▶** to build, deploy, and debug in one step:

```bash
npx cap open android
```

---

## Changing the App Version

The Android version is defined in **two files** that must be kept in sync manually — Capacitor does not propagate the version automatically.

### 1. `mobile/package.json`

The `version` field is the human-readable semantic version displayed in the app store and about screens.

```json
{
  "version": "1.2.0"
}
```

### 2. `mobile/android/app/build.gradle`

Two fields control the Android version:

| Field | Type | Purpose |
|-------|------|---------|
| `versionCode` | integer | Internal version number used by the Play Store and `adb`. **Must be strictly incremented** with every published release. |
| `versionName` | string | Human-readable version shown to the user (e.g. `"1.2.0"`). Should match `package.json`. |

```groovy
android {
    defaultConfig {
        versionCode 3          // increment by 1 for every release
        versionName "1.2.0"   // match package.json version
    }
}
```

> **Note:** `mobile/android/` is generated by `npx cap add android` and is not committed to git. After a fresh checkout or after deleting the android folder, re-create it with `npx cap add android` — the default `versionCode` and `versionName` will be reset and must be set again.

### Version update checklist

Before building a release APK:

- [ ] Update `"version"` in `mobile/package.json`
- [ ] Increment `versionCode` in `mobile/android/app/build.gradle`
- [ ] Set `versionName` in `mobile/android/app/build.gradle` to match `package.json`
- [ ] Run `npm run build:<locale>` + `npx cap sync android`
- [ ] Build with `./gradlew assembleRelease`

---

## Quick Reference — Full Build Sequence

```bash
# 1. Install dependencies (once)
cd mobile && npm install

# 2. Build web assets
npm run build

# 3. Sync Capacitor (MUST run after every web build)
npx cap sync android

# 4. Build APK
cd android && ./gradlew assembleDebug && cd ../..

# 5. Deploy
adb install mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

> **Important:** always run `npx cap sync android` after `npm run build:*`. Without it the Android project uses stale web assets from the previous build.

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| WebView shows blank page | Web assets not synced | Re-run `npx cap sync android` |
| GigaAM model not loading | Download failed or local storage is full | Open Settings → Offline speech models and retry the download with internet access and free storage |
| Microphone permission denied | Runtime permission not granted | The app requests it on first mic button press; check App Settings on device |
| TTS not speaking | Language not installed on device | Install the required language pack in Android Settings → Text-to-Speech |
| Build error: SDK not found | `ANDROID_HOME` not set | Export `ANDROID_HOME` and add `platform-tools` to `PATH` |
| i18n strings not updated | XLIFF files out of sync | Run `npm run extract-i18n`, update `messages.ru.xlf`, rebuild |
| `Unsupported class file major version 6x` | Gradle 8.x does not support Java 22+ | Set `org.gradle.java.home` in `android/gradle.properties` to a JDK 17 or 21 path (see below) |
| Speech recognition permission denied (`capacitor` mode) | Runtime permission not granted | The app requests it on first mic press; check App Settings → Permissions on the device |

### Fixing the Java version error

If your default `java` is version 22 or higher (check with `java -version`), Gradle will refuse to run with an error like `Unsupported class file major version 6x`. Fix it by pinning Gradle to JDK 21 in `mobile/android/gradle.properties`:

```properties
org.gradle.java.home=/path/to/jdk-21
```

Find available JDKs:

```bash
# Debian / Ubuntu
update-java-alternatives -l

# macOS (Homebrew)
/usr/libexec/java_home -V
```

Example for Ubuntu with OpenJDK 21:

```properties
org.gradle.java.home=/usr/lib/jvm/java-1.21.0-openjdk-amd64
```

This setting only affects the Gradle daemon — your system `JAVA_HOME` stays unchanged.

## Offline speech on desktop and Android

Run `cd mobile && npm ci && npm start`, then open `http://localhost:4200` in a current Chrome/Edge browser. Microphone capture requires localhost or HTTPS. In Settings → Offline speech models, select Русский or English and press Download model. The dialog shows progress and supports cancellation/retry. Download is never automatic. Select the matching speech language in Settings and save.

Russian uses the same GigaAM v3 E2E CTC int8 model and log-mel/CTC processing as [giga-pisar-android](https://github.com/moznoazachem/giga-pisar-android). English uses [GigaAM Multilingual CTC int8](https://huggingface.co/i2z1/gigaam-multilingual-ctc-onnx-int8), which also recognizes Russian but has moderate English accuracy. Both run in a Web Worker using locally bundled ONNX Runtime WASM (one thread, no COOP/COEP requirement). Audio is resampled to 16 kHz mono; long recordings are split near silence into chunks under 25 seconds. No audio is sent to an STT server. The old backend audio-upload endpoint has been removed; backend conversations accept `chat_message` text.

Each model is about 225 MB. Downloads are checked by size/SHA-256 and vocabulary shape before an atomic IndexedDB save. Incomplete downloads are not installed. The app requests persistent storage; clearing site/app data removes models. Desktop localhost ports and Android each have separate storage and need their own download. An offline desktop session still needs the local dev server running; Android bundles the app and runtime in the APK. TTS voices must be installed on the device for offline replies; a configured remote LLM still requires internet.

Hold the microphone button and release to recognize. On the first permission request, grant access and press again. With Auto enabled, speech lasting at least 280 ms followed by 800 ms of silence finishes the utterance and generates a reply. Recording is discarded during robot speech and resumes after TTS. Disabling Auto discards pending recognition. This is energy-based pause detection, not speaker identification; background noise can affect it.

`npm run build && npx cap sync android` copies all local worker/WASM assets to Android. Use a current Android System WebView with WebAssembly SIMD support. `npm run test:stt` checks feature extraction/CTC/chunking; the voice-button and VAD Jasmine specs cover pause timing, quick release, duplicate events, TTS suppression, and stopping Auto during recognition.

Android permissions are added automatically by the `capacitor:sync:after` hook, including microphone permission. The generated `mobile/android/` project stays outside Git; the hook is kept in the repository so a clean checkout can recreate it.

Optional browser checks (with Playwright available):

```bash
# After npm run build; set PLAYWRIGHT_MODULE / CHROME_PATH if installed elsewhere.
node scripts/browser-stt.cjs
# For real model inference, provide ru.onnx, ru-vocab.txt, ru.f32 and/or
# en.onnx, en-vocab.txt, en.f32 in a local fixture folder. PCM is 16 kHz mono float32.
STT_FIXTURE_DIR=/path/to/fixtures node scripts/recognition.browser.cjs ru
STT_FIXTURE_DIR=/path/to/fixtures node scripts/recognition.browser.cjs en
```

The real-model check validates the downloaded bytes against the production checksum, saves to IndexedDB, blocks external HTTPS access and runs WASM inference on the PCM fixture. Fixture models and recordings are not committed.
