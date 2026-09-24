from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"
    cors_origin: str = "http://localhost:5173"
    database_path: str = "data/reports.db"

    @property
    def mock_mode(self) -> bool:
        return not self.anthropic_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
