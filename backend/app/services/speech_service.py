from __future__ import annotations

import logging

from app.config import settings

logger = logging.getLogger(__name__)


class SpeechService:
    """faster-whisper STT wrapper.

    Full implementation will be added in a later phase.
    """

    def __init__(self) -> None:
        self._model_name = settings.whisper_model
        self._initialized = False

    async def initialize(self) -> None:
        logger.info(
            "SpeechService: initialization deferred (not yet implemented), "
            "model=%s",
            self._model_name,
        )
        self._initialized = True

    async def transcribe(self, audio_bytes: bytes) -> str:
        """Accept raw audio bytes and return transcribed text."""
        if not self._initialized:
            await self.initialize()
        return ""
