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
│  │  WhisperService  — STT via ONNX        │  │
│  │  (@xenova/transformers, runs locally)  │  │
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
└──────────────────────────────────────────────┘
```

Voice flow:

1. User holds the mic button → `capacitor-voice-recorder` captures audio.
2. On release → `WhisperService.transcribe()` resamples audio to 16 kHz and runs Whisper ONNX inference locally in the WebView.
3. The recognised text goes to `ChatService.processMessage()` — pure TypeScript keyword matching, no network call.
4. `ChatService` emits a `RobotResponse` with text and emotion; the robot face animates and TTS speaks the reply.

The Whisper model (`Xenova/whisper-base`, ~150 MB) is downloaded from Hugging Face CDN on first launch and cached in IndexedDB — after that the app works fully offline.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 20 LTS | `node --version` |
| npm | ≥ 10 | bundled with Node |
| Ionic CLI | ≥ 7 | `npm i -g @ionic/cli` |
| Angular CLI | ≥ 20 | installed locally via npm |
| Java JDK | 17 or 21 | `java -version`; required by Android Gradle |
| Android Studio | Hedgehog+ (2023.1+) | includes SDK, emulator |
| Android SDK | API 35 (target) | install via SDK Manager |
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

Choose the locale you want to ship:

```bash
# English build (default)
npm run build:en

# Russian build
npm run build:ru
```

Both commands output compiled assets to `mobile/www/`. Verify:

```bash
ls www/
# Should contain: index.html, main.*.js, polyfills.*.js, styles.*.css, assets/, ...
```

> To re-extract i18n source strings from templates after editing them, run:
> ```bash
> npm run extract-i18n
> ```
> This regenerates `src/locale/messages.xlf`. Update `src/locale/messages.ru.xlf` with the new translations before the next build.

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
```

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

## Quick Reference — Full Build Sequence

```bash
# 1. Install dependencies
cd mobile && npm install

# 2. Build web assets (choose locale)
npm run build:en   # or: npm run build:ru

# 3. Sync Capacitor
npx cap sync android

# 4. Build APK
cd android && ./gradlew assembleDebug && cd ../..

# 5. Deploy
adb install mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Troubleshooting

| Problem | Likely cause | Fix |
|---------|-------------|-----|
| WebView shows blank page | Web assets not synced | Re-run `npx cap sync android` |
| Whisper model not loading | Network blocked on first launch | Allow internet access on first run; after that the model is cached offline |
| Microphone permission denied | Runtime permission not granted | The app requests it on first mic button press; check App Settings on device |
| TTS not speaking | Language not installed on device | Install the required language pack in Android Settings → Text-to-Speech |
| Build error: SDK not found | `ANDROID_HOME` not set | Export `ANDROID_HOME` and add `platform-tools` to `PATH` |
| i18n strings not updated | XLIFF files out of sync | Run `npm run extract-i18n`, update `messages.ru.xlf`, rebuild |
