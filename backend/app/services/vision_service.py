from __future__ import annotations

import logging

from app.models.schemas import VisionResult

logger = logging.getLogger(__name__)


class VisionService:
    """MediaPipe + YOLOv8 wrapper.

    Full implementation will be added in a later phase.
    """

    def __init__(self) -> None:
        self._initialized = False

    async def initialize(self) -> None:
        logger.info("VisionService: initialization deferred (not yet implemented)")
        self._initialized = True

    async def analyze_frame(self, jpeg_bytes: bytes) -> VisionResult:
        """Accept a JPEG frame and return detected objects/gestures."""
        if not self._initialized:
            await self.initialize()
        return VisionResult()
