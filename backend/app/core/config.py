from functools import lru_cache
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    APP_NAME: str = "FaceSys Enterprise"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "production"
    TIMEZONE: str = "Asia/Tashkent"

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    # Keep 1: the poller starts inside the app lifespan.
    WORKERS: int = 1

    # Database
    DATABASE_HOST: str = "localhost"
    DATABASE_PORT: int = 5432
    DATABASE_NAME: str = "facesys"
    DATABASE_USER: str = "facesys"
    DATABASE_PASSWORD: str = ""
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10
    DATABASE_POOL_TIMEOUT: int = 30

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.DATABASE_USER}:{self.DATABASE_PASSWORD}"
            f"@{self.DATABASE_HOST}:{self.DATABASE_PORT}/{self.DATABASE_NAME}"
        )

    @property
    def DATABASE_URL_SYNC(self) -> str:
        return (
            f"postgresql://{self.DATABASE_USER}:{self.DATABASE_PASSWORD}"
            f"@{self.DATABASE_HOST}:{self.DATABASE_PORT}/{self.DATABASE_NAME}"
        )

    # Security
    SECRET_KEY: str = Field(..., min_length=32)
    REFRESH_SECRET_KEY: str = Field(..., min_length=32)
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    PASSWORD_HASH_ALGORITHM: str = "argon2"
    BCRYPT_ROUNDS: int = 12

    # Session
    SESSION_COOKIE_NAME: str = "facesys_session"
    SESSION_COOKIE_SECURE: bool = False  # Set True in production with HTTPS
    SESSION_COOKIE_HTTPONLY: bool = True
    SESSION_COOKIE_SAMESITE: str = "lax"

    # Rate Limiting
    LOGIN_RATE_LIMIT: int = 5
    LOGIN_RATE_LIMIT_WINDOW: int = 300  # 5 minutes
    API_RATE_LIMIT: int = 100
    API_RATE_LIMIT_WINDOW: int = 60  # 1 minute

    # CORS
    CORS_ORIGINS: List[str] = Field(default_factory=lambda: ["http://localhost:8080"])
    CORS_ALLOW_CREDENTIALS: bool = True
    CORS_ALLOW_METHODS: List[str] = Field(default_factory=lambda: ["*"])
    CORS_ALLOW_HEADERS: List[str] = Field(default_factory=lambda: ["*"])

    # Hikvision
    HIKVISION_TIMEOUT: int = 10
    HIKVISION_RETRY_ATTEMPTS: int = 3
    HIKVISION_RETRY_DELAY: int = 5
    HIKVISION_SYNC_INTERVAL: int = 300  # 5 minutes
    HIKVISION_EVENT_BUFFER_SIZE: int = 1000

    # Backup
    BACKUP_DIR_SSD: str = "/var/backups/facesys/ssd"
    BACKUP_DIR_HDD: str = "/mnt/backup_hdd/facesys"
    BACKUP_HDD_MOUNT: str = "/mnt/backup_hdd"
    BACKUP_RETENTION_DAYS_SSD: int = 7
    BACKUP_RETENTION_DAYS_HDD: int = 90
    BACKUP_SCHEDULE: str = "0 2 * * *"  # Daily at 2 AM

    # Audit
    AUDIT_LOG_RETENTION_DAYS: int = 365

    # Pagination
    DEFAULT_PAGE_SIZE: int = 20
    MAX_PAGE_SIZE: int = 100

    # Export
    EXPORT_MAX_ROWS: int = 10000


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()