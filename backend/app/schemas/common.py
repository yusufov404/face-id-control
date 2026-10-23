from datetime import datetime
from typing import Generic, TypeVar, Optional

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(BaseModel):
    detail: str


class PaginationParams(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=100)
    search: Optional[str] = None
    ordering: Optional[str] = None


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class TimestampSchema(ORMModel):
    created_at: datetime
    updated_at: datetime


class SoftDeleteSchema(TimestampSchema):
    is_deleted: bool = False
    deleted_at: Optional[datetime] = None