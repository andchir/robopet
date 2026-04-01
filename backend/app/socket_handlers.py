from __future__ import annotations

import base64
import logging

import socketio

from app.config import settings
from app.services.chat_service import ChatService
from app.services.emotion_service import EmotionService
from app.services.speech_service import SpeechService
from app.services.vision_service import VisionService

logger = logging.getLogger(__name__)

vision_service = VisionService()
speech_service = SpeechService()
chat_service = ChatService()
emotion_service = EmotionService()


def register_handlers(sio: socketio.AsyncServer) -> None:
    """Register all Socket.IO event handlers on the given server."""

    @sio.event
    async def connect(sid: str, environ: dict) -> None:
        logger.info("Client connected: %s", sid)
        await sio.emit("welcome", {"message": "Connected to RoboPet server"}, to=sid)

    @sio.event
    async def disconnect(sid: str) -> None:
        logger.info("Client disconnected: %s", sid)

    @sio.on("video_frame")
    async def handle_video_frame(sid: str, data: dict) -> None:
        """Receive a JPEG frame (base64), run vision analysis, store context.

        Expected payload: {"frame": "<base64-encoded JPEG>"}
        """
        frame_b64: str | None = data.get("frame")
        if not frame_b64:
            return

        try:
            jpeg_bytes = base64.b64decode(frame_b64)
        except Exception:
            logger.warning("Invalid base64 in video_frame from %s", sid)
            return

        result = await vision_service.analyze_frame(jpeg_bytes)

        async with sio.session(sid) as session:
            session["last_vision"] = result

        if result.objects or result.gestures:
            await sio.emit(
                "vision_result",
                result.model_dump(),
                to=sid,
            )

    @sio.on("audio_data")
    async def handle_audio_data(sid: str, data: dict) -> None:
        """Receive audio (base64), transcribe, generate response.

        Expected payload: {"audio": "<base64-encoded audio>", "language": "en"}
        Language defaults to the server-configured language when not provided.
        """
        audio_b64: str | None = data.get("audio")
        if not audio_b64:
            return

        language: str = data.get("language") or settings.language

        try:
            audio_bytes = base64.b64decode(audio_b64)
        except Exception:
            logger.warning("Invalid base64 in audio_data from %s", sid)
            return

        audio_kb = len(audio_bytes) / 1024
        logger.info("🎤 Audio received  sid=%s  lang=%s  size=%.1f KB", sid, language, audio_kb)

        transcription = await speech_service.transcribe(audio_bytes, language=language)

        if not transcription:
            logger.warning("🔇 STT returned empty result  sid=%s", sid)
            await sio.emit(
                "transcription",
                {"text": "", "status": "empty"},
                to=sid,
            )
            return

        logger.info("📝 STT result      sid=%s  text=%r", sid, transcription)
        await sio.emit("transcription", {"text": transcription, "status": "ok"}, to=sid)

        async with sio.session(sid) as session:
            last_vision = session.get("last_vision")

        response_text = await chat_service.get_response(
            transcription, last_vision, language=language
        )
        emotion = await emotion_service.detect_emotion(response_text)

        logger.info("🤖 Robot response  sid=%s  emotion=%s  text=%r", sid, emotion.value, response_text)
        await sio.emit(
            "robot_response",
            {"text": response_text, "emotion": emotion.value},
            to=sid,
        )

    @sio.on("chat_message")
    async def handle_chat_message(sid: str, data: dict) -> None:
        """Receive a text message directly (skip STT).

        Expected payload: {"text": "user message", "language": "en"}
        """
        text: str | None = data.get("text")
        if not text:
            return

        language: str = data.get("language") or settings.language

        logger.info("💬 Chat message    sid=%s  lang=%s  text=%r", sid, language, text)

        async with sio.session(sid) as session:
            last_vision = session.get("last_vision")

        response_text = await chat_service.get_response(
            text, last_vision, language=language
        )
        emotion = await emotion_service.detect_emotion(response_text)

        logger.info("🤖 Robot response  sid=%s  emotion=%s  text=%r", sid, emotion.value, response_text)
        await sio.emit(
            "robot_response",
            {"text": response_text, "emotion": emotion.value},
            to=sid,
        )
