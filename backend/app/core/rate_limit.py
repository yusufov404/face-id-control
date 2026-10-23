"""Simple in-process sliding-window rate limiter.

For a single-node LAN deployment this is sufficient. If you scale to multiple
workers and need a shared limit, swap the store for Redis.
"""
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
    def __init__(self, max_events: int, window_seconds: int):
        self.max_events = max_events
        self.window = window_seconds
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        bucket = self._hits[key]
        while bucket and now - bucket[0] > self.window:
            bucket.popleft()
        if len(bucket) >= self.max_events:
            retry = int(self.window - (now - bucket[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Juda ko'p urinish. {retry} soniyadan keyin qayta urinib ko'ring.",
                headers={"Retry-After": str(retry)},
            )
        bucket.append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)


def client_key(request: Request, prefix: str = "") -> str:
    """Return a rate-limit / audit key for the caller.

    Only the socket peer address is used. ``X-Forwarded-For`` is deliberately
    ignored here: it is client-controlled unless a trusted reverse proxy has
    already rewritten it. In the supported deployment uvicorn runs with
    ``--proxy-headers --forwarded-allow-ips=127.0.0.1`` behind Nginx, so
    ``request.client.host`` is the real LAN client. With the raw socket, a
    spoofed header can no longer rotate the login rate-limit bucket.
    """
    ip = request.client.host if request.client else "unknown"
    return f"{prefix}:{ip}"