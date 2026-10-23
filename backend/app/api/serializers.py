"""Helpers to avoid async lazy-load (MissingGreenlet) errors in serializers."""
from typing import Any, Optional


def is_loaded(obj: Any, attr: str) -> bool:
    """True if a relationship attribute is already populated (no lazy load needed)."""
    try:
        return attr in obj.__dict__
    except Exception:
        return False


def safe_attr(obj: Any, attr: str) -> Optional[Any]:
    if obj is None or not is_loaded(obj, attr):
        return None
    return getattr(obj, attr, None)


def safe_name(rel: Any, attr: str = "name") -> Optional[str]:
    if rel is None:
        return None
    return getattr(rel, attr, None)