from __future__ import annotations

import logging
import os
import tempfile

from app.config import settings

logger = logging.getLogger(__name__)

# Whisper language codes map from BCP-47 to ISO 639-1
_LANG_MAP: dict[str, str] = {
    "en": "en",
    "en-us": "en",
    "en-gb": "en",
    "ru": "ru",
    "ru-ru": "ru",
}


class SpeechService:
    """Local STT via faster-whisper. No external API required."""

    def __init__(self) -> None:
        self._model_name = settings.whisper_model
        self._model = None

    async def initialize(self) -> None:
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel  # type: ignore[import]

            logger.info("Loading Whisper model '%s'…", self._model_name)
            self._model = WhisperModel(
                self._model_name, device="cpu", compute_type="int8"
            )
            logger.info("Whisper model loaded")
        except Exception as exc:
            logger.error("Failed to load Whisper model: %s", exc)

    async def transcribe(self, audio_bytes: bytes, language: str | None = None) -> str:
        """Transcribe raw audio bytes and return the recognised text."""
        if self._model is None:
            await self.initialize()
        if self._model is None:
            logger.warning("Whisper not available — returning empty transcription")
            return ""

        # Normalise BCP-47 tag to ISO 639-1 code expected by Whisper
        whisper_lang: str | None = None
        if language:
            whisper_lang = _LANG_MAP.get(language.lower())

        tmp_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            kwargs: dict = {"beam_size": 5}
            if whisper_lang:
                kwargs["language"] = whisper_lang

            logger.info("⏳ Running Whisper  hint_lang=%s  model=%s", whisper_lang, self._model_name)
            segments, info = self._model.transcribe(tmp_path, **kwargs)
            text = " ".join(seg.text for seg in segments).strip()
            logger.info(
                "✅ STT done  detected_lang=%s  hint=%s  text=%r",
                info.language,
                whisper_lang,
                text,
            )
            return text
        except Exception as exc:
            logger.error("❌ Transcription error: %s", exc)
            return ""
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
