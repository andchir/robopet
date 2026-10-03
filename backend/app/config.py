from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    yolo_model: str = "yolov8n.pt"

    robot_name: str = "RoboPet"
    language: str = "en"

    server_host: str = "0.0.0.0"
    server_port: int = 8000
    log_level: str = "info"


settings = Settings()
