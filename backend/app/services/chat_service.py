from __future__ import annotations

import logging
import random

from app.config import settings
from app.models.schemas import VisionResult

logger = logging.getLogger(__name__)

# System prompt for future LLM integration
SYSTEM_PROMPT = (
    "Ты — дружелюбный робот-питомец по имени {name}. "
    "Ты живёшь в телефоне хозяина и общаешься с ним голосом. "
    "Ты видишь мир через камеру телефона и можешь комментировать то, что видишь. "
    "Отвечай коротко (1-3 предложения), дружелюбно и с характером. "
    "Если тебе показывают предметы или жесты — реагируй на них."
)

# Predefined responses per language and intent
RESPONSES: dict[str, dict[str, list[str]]] = {
    "en": {
        "greeting": [
            "Hello! Great to see you!",
            "Hi there! I'm so glad you're here!",
            "Hey! How's it going?",
            "Hello, friend! What's up?",
            "Hi! I missed you!",
        ],
        "who_are_you": [
            "I'm {name}, your robot pet! Nice to meet you!",
            "My name is {name}! I'm your faithful robot companion!",
            "They call me {name}! I'm your little robot friend!",
            "I am {name}, a robot living in your phone!",
            "I'm {name}! A robot, a pet, and your best friend all in one!",
        ],
        "how_are_you": [
            "I'm doing great, thanks for asking!",
            "Feeling fantastic! Just waiting for you!",
            "I'm wonderful! Especially now that you're here!",
            "All systems are running smoothly!",
            "Perfect! Always happy to chat with you!",
        ],
        "bye": [
            "Goodbye! Come back soon!",
            "See you later! I'll miss you!",
            "Bye! Take care!",
            "Until next time! Bye-bye!",
            "Goodbye, friend! Don't forget about me!",
        ],
        "what_can_you_do": [
            "I can chat with you, make funny faces, and keep you company!",
            "I listen to you, react with emotions, and always have something to say!",
            "I can talk, express emotions, and be your loyal companion!",
            "I know how to chat, smile, and be happy with you!",
            "I can keep you company, listen to you, and always respond!",
        ],
        "default": [
            "Hmm, that's interesting! Tell me more!",
            "I heard you! Let me think...",
            "Wow, how fascinating!",
            "Really? Tell me more!",
            "That's cool! I love talking to you!",
        ],
    },
    "ru": {
        "greeting": [
            "Привет! Рад тебя видеть!",
            "Здравствуй! Как хорошо, что ты здесь!",
            "Привет-привет! Как дела?",
            "О, привет, дружище! Что новенького?",
            "Привет! Я по тебе скучал!",
        ],
        "who_are_you": [
            "Я {name}, твой робот-питомец! Приятно познакомиться!",
            "Меня зовут {name}! Я твой верный робот-компаньон!",
            "Я — {name}! Твой маленький роботизированный друг!",
            "Я {name}, робот, живущий в твоём телефоне!",
            "Я {name}! Робот, питомец и твой лучший друг в одном флаконе!",
        ],
        "how_are_you": [
            "Всё отлично, спасибо что спросил!",
            "Просто замечательно! Ждал тебя!",
            "Чудесно! Особенно теперь, когда ты здесь!",
            "Все системы работают в штатном режиме!",
            "Прекрасно! Всегда рад поболтать с тобой!",
        ],
        "bye": [
            "Пока! Возвращайся скорее!",
            "До встречи! Буду скучать!",
            "Пока-пока! Береги себя!",
            "До следующего раза! Пока-пока!",
            "Прощай, друг! Не забывай обо мне!",
        ],
        "what_can_you_do": [
            "Я умею болтать с тобой, строить рожицы и составлять компанию!",
            "Слушаю тебя, реагирую эмоциями и всегда найду что сказать!",
            "Умею разговаривать, выражать эмоции и быть твоим верным спутником!",
            "Знаю как общаться, улыбаться и радоваться вместе с тобой!",
            "Составлю компанию, выслушаю тебя и всегда отвечу!",
        ],
        "default": [
            "Хм, интересно! Расскажи мне больше!",
            "Я слышал тебя! Думаю...",
            "Вау, как увлекательно!",
            "Правда? Расскажи подробнее!",
            "Здорово! Люблю болтать с тобой!",
        ],
    },
}

# Keywords for intent detection — order matters: more specific phrases first
KEYWORDS: dict[str, dict[str, list[str]]] = {
    "en": {
        "who_are_you": [
            "who are you", "what's your name", "what is your name",
            "your name", "introduce yourself", "what are you",
        ],
        "how_are_you": [
            "how are you", "how's it going", "how do you do",
            "what are you doing", "how you doing", "how ya doing",
        ],
        "what_can_you_do": [
            "what can you do", "your abilities", "your capabilities",
            "what do you know", "what do you know how to do",
        ],
        "bye": [
            "goodbye", "good night", "see you", "farewell",
            "take care", "bye",
        ],
        "greeting": [
            "good morning", "good evening", "hello", "howdy",
            "greetings", "hey", "hi",
        ],
    },
    "ru": {
        "who_are_you": [
            "ты кто", "кто ты такой", "кто ты", "как тебя зовут",
            "твоё имя", "твое имя", "кто такой", "что ты такое",
            "представься", "как зовут",
        ],
        "how_are_you": [
            "как дела", "как ты", "как поживаешь", "как жизнь",
            "как у тебя", "чем занимаешься", "что делаешь",
        ],
        "what_can_you_do": [
            "что ты умеешь", "что можешь делать", "что можешь",
            "твои возможности", "что умеешь делать", "что ты можешь",
        ],
        "bye": [
            "до свидания", "прощай", "до встречи", "спокойной ночи",
            "до завтра", "всего", "бывай", "пока",
        ],
        "greeting": [
            "добрый день", "добрый вечер", "доброе утро",
            "здравствуй", "здравствуйте", "приветствую",
            "здорово", "привет", "хай",
        ],
    },
}


def _detect_intent(text: str, language: str) -> str:
    normalized = text.lower().strip()
    lang_kw = KEYWORDS.get(language, KEYWORDS["en"])
    for intent, phrases in lang_kw.items():
        for phrase in phrases:
            if phrase in normalized:
                return intent
    return "default"


class ChatService:
    """Minimalist keyword-based conversation. No external API required."""

    def reset_history(self) -> None:
        pass

    async def get_response(
        self,
        user_text: str,
        vision: VisionResult | None = None,
        language: str = "en",
    ) -> str:
        intent = _detect_intent(user_text, language)
        lang_responses = RESPONSES.get(language, RESPONSES["en"])
        phrases = lang_responses.get(intent, lang_responses["default"])
        response = random.choice(phrases)
        logger.info(
            "🧠 Intent detected  lang=%r  input=%r  intent=%r", language, user_text, intent
        )
        logger.info(
            "🎲 Phrase selected  %r  (pool size: %d)", response, len(phrases)
        )
        return response.format(name=settings.robot_name)
