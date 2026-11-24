"""Application configuration, loaded from environment variables / .env."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "ProsParity"
    environment: str = "development"  # development | production | test
    database_url: str = "mysql+pymysql://prosparity:prosparity@localhost:3306/prosparity?charset=utf8mb4"
    sql_echo: bool = False
    # TLS to the database (required by hosted MySQL such as TiDB Cloud). Verified against the public CA
    # bundle (certifi) unless DB_SSL_CA points to a custom CA file.
    db_ssl: bool = False
    db_ssl_ca: str = ""
    # keep small on free database tiers, which cap concurrent connections
    db_pool_size: int = 5
    db_max_overflow: int = 5

    jwt_secret: str = "change-me-in-production-please-32chars"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60  # session timeout
    refresh_token_days: int = 7
    password_reset_minutes: int = 30

    business_timezone: str = "Asia/Kolkata"
    cors_origins: str = "http://localhost:5173,http://localhost:8080,http://127.0.0.1:5173"
    # optional regex for extra allowed origins, e.g. Vercel preview deployments:
    #   https://prosparity-[a-z0-9-]+\.vercel\.app
    cors_origin_regex: str = ""
    frontend_url: str = "http://localhost:5173"

    upload_dir: str = "./storage/uploads"
    report_dir: str = "./storage/reports"

    enable_scheduler: bool = True

    # Collection Dashboard attendance sync (pull API)
    collection_api_base_url: str = "https://collection.prosparity.in"
    collection_api_key: str = "0UInlx2TiNEaSR9oyVL9PtuaBCBJHbMBGCD5RNEVzs8"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_dev(self) -> bool:
        return self.environment != "production"


_DEFAULT_SECRETS = {"change-me-in-production-please-32chars", "change-me-to-a-long-random-string",
                    "change-me-to-a-long-random-string-at-least-32-chars"}


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.environment == "production" and (s.jwt_secret in _DEFAULT_SECRETS or len(s.jwt_secret) < 32):
        raise RuntimeError("JWT_SECRET must be set to a random string of at least 32 characters in production")
    return s


settings = get_settings()
