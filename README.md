# RoboPet

![RoboPet](https://github.com/andchir/robopet/blob/main/images/screenshot3.png?raw=true)

A mobile robot-pet companion app. The phone displays an animated robot face that sees through the camera, listens via microphone, and talks back using text-to-speech — with offline GigaAM speech recognition on desktop and Android, plus an optional AI backend on your local network.

**Frontend** — Ionic 8 + Angular 20 + Capacitor 8 (Android / iOS / browser).
**Backend** — Python FastAPI + Socket.IO with keyword-based conversation and a placeholder vision service. Vision/ML packages are not needed by the current implementation.

## Prerequisites

- Node.js 20+, npm 10+
- Python 3.11+
- An OpenAI-compatible API key (optional; configure it in the app for online AI responses)

## Running in Development

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env if you need to change backend server or robot defaults

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The server starts at `http://0.0.0.0:8000`.

### Frontend

```bash
cd mobile
npm install
ionic serve
```

Opens at `http://localhost:8100`. For online AI responses, open **Settings → AI assistant**
and enter the API base URL, API key, and model. These settings are saved on the device
and used directly by the frontend. Backend `.env` settings do not configure API access;
the optional backend provides local keyword-based replies and needs no API key.

To run on a physical device:

```bash
ionic build
npx cap sync
npx cap open android   # or: npx cap open ios
```

Then build and run from Android Studio / Xcode.

Voice recognition defaults to GigaAM (Russian v3 / English Multilingual). Download each model once using **Settings → Offline speech models**; progress is shown in a dialog. Afterwards recognition runs locally without internet. Hold/release the microphone button, or enable **Auto** to reply after a speech pause. See [BUILD.md](BUILD.md) for setup and offline limits.

### Offline AI speech: Supertonic 3

Supertonic 3 is the default TTS engine. Settings retain **System voice** as an
alternative and provide ten Supertonic presets (M1–M5, F1–F5), plus Listen/Stop.
The preview uses the currently selected language and voice before saving.
Save applies these choices to AI replies. If the bundle is missing, speaking
opens its download dialog; downloading starts only when the user presses Download.
The approximately 401 MB bundle supports both Russian and English and all presets.
Verified files are kept in IndexedDB; interrupted downloads reuse completed files.
No Python packages or inference server are required. ONNX Runtime WASM is bundled
locally and runs in a worker on desktop browsers and Android WebView.
Clearing app/site storage removes downloaded models.

Model: https://huggingface.co/supertone-oss-archive/supertonic-3
(pinned revision in `mobile/src/assets/supertonic/manifest.mjs`, OpenRAIL-M).
Text processing is adapted from Supertone's MIT example; license is included in
`mobile/src/assets/supertonic/LICENSE`.

Real browser inference check (official files downloaded outside the repository):
`MODEL_DIR=/path/to/files PLAYWRIGHT_MODULE=/path/to/playwright node mobile/scripts/supertonic.browser.cjs`.
Build the frontend first. The check verifies model checksums and synthesizes RU/M1
and EN/F1 with networking disabled. Android hardware still needs device validation.

### Local answers and API availability

Without a network connection or complete API settings, chat uses lightweight local
responses and does not call the API. A failed/invalid API response or a 12-second
timeout also falls back locally and disables further API attempts. Reconnecting
permits another attempt after connection/server failures; saving API settings
resets the block, including authentication/configuration errors. No background
health checks run.

When API access is available, local intents require whole-word phrase matches
covering at least 75% of the utterance, with only polite words or the robot's name
outside the match. Long phrases with only one or two matched words and questions
with additional substantive words go to the API. Offline matching is more
permissive. Tests: `src/app/services/chat.service.spec.ts` in the mobile app.
