# RoboPet

![RoboPet](https://github.com/andchir/robopet/blob/main/images/screenshot3.png?raw=true)

A mobile robot-pet companion app. The phone displays an animated robot face that sees through the camera, listens via microphone, and talks back using text-to-speech — with offline GigaAM speech recognition on desktop and Android, plus an optional AI backend on your local network.

**Frontend** — Ionic 8 + Angular 20 + Capacitor 8 (Android / iOS / browser).
**Backend** — Python FastAPI + Socket.IO with keyword-based conversation and a placeholder vision service. Vision/ML packages are not needed by the current implementation.

## Prerequisites

- Node.js 20+, npm 10+
- Python 3.11+
- An OpenAI-compatible API key

## Running in Development

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env — set OPENAI_API_KEY (required)

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The server starts at `http://0.0.0.0:8000`.

### Frontend

```bash
cd mobile
npm install
ionic serve
```

Opens at `http://localhost:8100`. Go to **Settings** and enter the backend IP/port.

To run on a physical device:

```bash
ionic build
npx cap sync
npx cap open android   # or: npx cap open ios
```

Then build and run from Android Studio / Xcode.

Voice recognition defaults to GigaAM (Russian v3 / English Multilingual). Download each model once using **Settings → Offline speech models**; progress is shown in a dialog. Afterwards recognition runs locally without internet. Hold/release the microphone button, or enable **Auto** to reply after a speech pause. See [BUILD.md](BUILD.md) for setup and offline limits.
