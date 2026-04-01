from __future__ import annotations

import logging

from app.config import settings
from app.models.schemas import VisionResult

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты — дружелюбный робот-питомец по имени RoboPet. "
    "Ты живёшь в телефоне хозяина и общаешься с ним голосом. "
    "Ты видишь мир через камеру телефона и можешь комментировать то, что видишь. "
    "Отвечай коротко (1-3 предложения), дружелюбно и с характером. "
    "Если тебе показывают предметы или жесты — реагируй на них."
)


class ChatService:
    """OpenAI chat wrapper with conversation history.

    Full implementation will be added in a later phase.
    """

    def __init__(self) -> None:
        self._model = settings.openai_model
        self._history: list[dict[str, str]] = []

    def reset_history(self) -> None:
        self._history.clear()

    def _build_cv_context(self, vision: VisionResult | None) -> str:
        if not vision or (not vision.objects and not vision.gestures):
            return ""
        parts: list[str] = []
        if vision.objects:
            labels = ", ".join(
                f"{o.label} ({o.confidence:.0%})" for o in vision.objects
            )
            parts.append(f"Вижу объекты: {labels}")
        if vision.gestures:
            names = ", ".join(
                f"{g.name} ({g.confidence:.0%})" for g in vision.gestures
            )
            parts.append(f"Жесты: {names}")
        return ". ".join(parts) + "."

    async def get_response(
        self,
        user_text: str,
        vision: VisionResult | None = None,
    ) -> str:
        """Generate a chat response given user text and optional CV context."""
        cv_context = self._build_cv_context(vision)
        if cv_context:
            user_text = f"[Контекст камеры: {cv_context}]\n{user_text}"

        logger.info("ChatService: generating response (stub), model=%s", self._model)
        return "Привет! Я RoboPet, пока учусь отвечать. 🐾"
