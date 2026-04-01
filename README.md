# RoboPet

A mobile robot-pet companion app. The phone displays an animated robot face that sees through the camera, listens via microphone, and talks back using text-to-speech — all powered by an AI backend running on your local network.

**Frontend** — Ionic 8 + Angular 19 + Capacitor 6 (Android / iOS / browser).
**Backend** — Python FastAPI + Socket.IO, with MediaPipe + YOLOv8 for vision, faster-whisper for speech-to-text, and OpenAI-compatible API for conversation.

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
