from enum import Enum

from pydantic import BaseModel


class EmotionType(str, Enum):
    HAPPY = "happy"
    SAD = "sad"
    SURPRISED = "surprised"
    ANGRY = "angry"
    THINKING = "thinking"
    NEUTRAL = "neutral"
    EXCITED = "excited"


class DetectedObject(BaseModel):
    label: str
    confidence: float


class DetectedGesture(BaseModel):
    name: str
    confidence: float


class VisionResult(BaseModel):
    objects: list[DetectedObject] = []
    gestures: list[DetectedGesture] = []


class RobotResponse(BaseModel):
    text: str
    emotion: EmotionType = EmotionType.NEUTRAL
