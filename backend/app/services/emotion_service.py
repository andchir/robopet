from __future__ import annotations

import logging

from app.models.schemas import EmotionType

logger = logging.getLogger(__name__)


class EmotionService:
    """Determine robot emotion from response text.

    Full implementation will be added in a later phase.
    """

    async def detect_emotion(self, text: str) -> EmotionType:
        """Analyze response text and return an appropriate emotion."""
        lower = text.lower()

        positive = {"рад", "ура", "круто", "класс", "люблю", "привет", "здорово", "🐾"}
        sad = {"грустно", "жаль", "печально", "скучаю"}
        surprised = {"ого", "ничего себе", "вау", "wow", "невероятно"}
        angry = {"злюсь", "плохо", "ненавижу", "раздражает"}
        thinking = {"думаю", "хмм", "интересно", "наверное"}

        if any(w in lower for w in surprised):
            return EmotionType.SURPRISED
        if any(w in lower for w in sad):
            return EmotionType.SAD
        if any(w in lower for w in angry):
            return EmotionType.ANGRY
        if any(w in lower for w in thinking):
            return EmotionType.THINKING
        if any(w in lower for w in positive):
            return EmotionType.HAPPY

        return EmotionType.NEUTRAL
