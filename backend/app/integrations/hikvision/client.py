"""Hikvision ISAPI client.

Honest capability handling: every optional feature (alertStream, event search,
time sync) is probed and reported as supported/unsupported. Nothing is assumed
to work. Passwords never appear in logs or repr output.

Authentication: HTTP Digest, which is what Hikvision ISAPI devices use. Basic
authentication is not implemented; a device configured for Basic only will be
reported as unreachable/unauthenticated instead of being silently misreported.
"""
from __future__ import annotations

import hashlib
import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, AsyncIterator

import httpx

logger = logging.getLogger("facesys.hikvision")

# Never log request headers containing credentials
SENSITIVE_HEADERS = {"authorization", "cookie", "set-cookie"}


def _safe_url(url: str) -> str:
    # strip any userinfo that may have slipped into the URL
    return re.sub(r"//[^/@]+@", "//", url)


@dataclass
class DeviceInfo:
    model: Optional[str] = None
    firmware: Optional[str] = None
    serial_number: Optional[str] = None
    device_type: Optional[str] = None
    device_name: Optional[str] = None
    mac_address: Optional[str] = None
    raw: dict = field(default_factory=dict)


@dataclass
class AcsEvent:
    event_id: str
    employee_no: Optional[str]
    event_time: datetime
    major_type: int
    sub_type: int
    verify_mode: Optional[str]
    similarity: Optional[float]
    raw: dict = field(default_factory=dict)

    @property
    def is_check_in(self) -> bool:
        # AcsEvent major=5 (Access Control), sub=1 entry / 2 exit in common firmware
        return self.sub_type in (1, 75)  # 75 = face verified entry on newer FW

    @property
    def is_check_out(self) -> bool:
        return self.sub_type in (2, 76)


class ISAPIError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class HikvisionClient:
    """Async ISAPI client for a single device."""

    def __init__(
        self,
        ip_address: str,
        port: int,
        username: str,
        password: str,
        *,
        scheme: str = "http",
        timeout: int = 10,
    ):
        self.base_url = f"{scheme}://{ip_address}:{port}"
        self.username = username
        self._password = password
        self.timeout = timeout

    def __repr__(self) -> str:
        return f"<HikvisionClient {_safe_url(self.base_url)} user={self.username!r}>"

    # ------------------------------------------------------------------ transport
    def _client(self, *, stream: bool = False) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.base_url,
            auth=httpx.DigestAuth(self.username, self._password),
            timeout=httpx.Timeout(self.timeout, read=None if stream else self.timeout),
            verify=False,  # devices use self-signed certs; isolated LAN
            follow_redirects=True,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> httpx.Response:
        try:
            async with self._client() as client:
                resp = await client.request(method, path, json=json_body, params=params)
        except httpx.HTTPError as exc:
            raise ISAPIError(f"Qurilma bilan aloqa yo'q: {type(exc).__name__}") from exc
        if resp.status_code == 401:
            raise ISAPIError("Autentifikatsiya muvaffaqiyatsiz (login/parol)", 401)
        if resp.status_code >= 400:
            raise ISAPIError(
                f"ISAPI xatosi {resp.status_code}: {resp.text[:200]}", resp.status_code
            )
        return resp

    # ------------------------------------------------------------------ device info
    async def get_device_info(self) -> DeviceInfo:
        resp = await self._request("GET", "/ISAPI/System/deviceInfo")
        root = ET.fromstring(resp.text)
        # Hikvision XML uses default namespace; strip it
        for el in root.iter():
            if "}" in el.tag:
                el.tag = el.tag.split("}", 1)[1]
        def g(tag: str) -> Optional[str]:
            node = root.find(f".//{tag}")
            return node.text if node is not None else None
        return DeviceInfo(
            model=g("model"),
            firmware=g("firmwareVersion"),
            serial_number=g("serialNumber"),
            device_type=g("deviceType"),
            device_name=g("deviceName"),
            mac_address=g("macAddress"),
            raw={"text": resp.text[:4000]},
        )

    async def probe_alert_stream(self) -> bool:
        """Check whether the alert stream endpoint accepts a connection.

        A plain GET on alertStream never completes: the device keeps the
        response open. We therefore open a stream, inspect the response status
        as soon as headers arrive and close it immediately. This reports
        "supported" only when the device actually accepted the subscription;
        timeouts and 4xx/5xx responses report False.
        """
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                auth=httpx.DigestAuth(self.username, self._password),
                # A supported stream stays open, so only the header wait is
                # timed out; after that we close the response ourselves.
                timeout=httpx.Timeout(self.timeout),
                verify=False,
                follow_redirects=True,
            ) as client:
                async with client.stream(
                    "GET", "/ISAPI/Event/notification/alertStream"
                ) as resp:
                    return resp.status_code < 400
        except (httpx.HTTPError, OSError):
            return False
        except Exception:  # defensive: never let a probe break diagnostics
            return False

    async def get_capabilities(self) -> dict:
        """Probe optional capabilities honestly.

        Every entry is the result of an actual request. A feature that we could
        not verify is reported as ``False`` — never as supported.
        """
        caps: dict[str, bool] = {
            "alert_stream": False,
            "event_search": False,
            "time_sync": False,
            "user_info": False,
        }

        # alertStream needs special handling (long-lived response).
        caps["alert_stream"] = await self.probe_alert_stream()

        probes = {
            "event_search": "/ISAPI/AccessControl/AcsEvent/capabilities?format=json",
            "time_sync": "/ISAPI/System/time",
            "user_info": "/ISAPI/AccessControl/UserInfo/capabilities?format=json",
        }
        for name, path in probes.items():
            try:
                resp = await self._request("GET", path)
                caps[name] = resp.status_code < 400
            except Exception:
                caps[name] = False
        return caps

    async def get_device_time(self) -> Optional[datetime]:
        try:
            resp = await self._request("GET", "/ISAPI/System/time")
            root = ET.fromstring(resp.text)
            for el in root.iter():
                if "}" in el.tag:
                    el.tag = el.tag.split("}", 1)[1]
            node = root.find(".//localTime")
            if node is None:
                node = root.find(".//time")
            if node is not None and node.text:
                text = node.text.strip()
                for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
                    try:
                        return datetime.strptime(text, fmt)
                    except ValueError:
                        continue
        except ISAPIError:
            return None
        return None

    async def check_time_drift(self) -> Optional[int]:
        device_time = await self.get_device_time()
        if device_time is None:
            return None
        if device_time.tzinfo is None:
            device_time = device_time.replace(tzinfo=timezone.utc)
        server = datetime.now(timezone.utc)
        return int((device_time - server).total_seconds())

    # ------------------------------------------------------------------ events
    async def search_events(
        self,
        *,
        start: datetime,
        end: datetime,
        position: int = 0,
        max_results: int = 30,
        employee_no: Optional[str] = None,
    ) -> list[AcsEvent]:
        """POST /ISAPI/AccessControl/AcsEvent?format=json"""
        body = {
            "AcsEventCond": {
                "searchID": f"facesys-{int(datetime.now().timestamp())}",
                "searchResultPosition": position,
                "maxResults": max_results,
                "major": 0,
                "minor": 0,
                "startTime": start.strftime("%Y-%m-%dT%H:%M:%S%z") or start.isoformat(),
                "endTime": end.strftime("%Y-%m-%dT%H:%M:%S%z") or end.isoformat(),
            }
        }
        if employee_no:
            body["AcsEventCond"]["employeeNoString"] = employee_no
        resp = await self._request(
            "POST", "/ISAPI/AccessControl/AcsEvent?format=json", json_body=body
        )
        try:
            data = resp.json()
        except Exception as exc:
            raise ISAPIError("AcsEvent javobi JSON emas") from exc

        info = data.get("AcsEvent", {}) or {}
        items = info.get("InfoList", []) or []
        out: list[AcsEvent] = []
        for item in items:
            out.append(self._parse_acs_event(item))
        return out

    def _parse_acs_event(self, item: dict) -> AcsEvent:
        serial = str(item.get("serialNo") or item.get("eventId") or "")
        if not serial:
            serial = hashlib.sha256(repr(item).encode()).hexdigest()[:24]
        time_str = item.get("time") or item.get("eventTime") or ""
        event_time = datetime.now(timezone.utc)
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                event_time = datetime.strptime(time_str, fmt)
                break
            except ValueError:
                continue
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)
        sim = None
        for key in ("similarity", "faceSimilarity", "matchingScore"):
            if isinstance(item.get(key), (int, float)):
                sim = float(item[key])
                break
        return AcsEvent(
            event_id=serial,
            employee_no=item.get("employeeNoString") or item.get("employeeNo"),
            event_time=event_time,
            major_type=int(item.get("major", 0) or 0),
            sub_type=int(item.get("minor", 0) or 0),
            verify_mode=item.get("currentVerifyMode") or item.get("verifyMode"),
            similarity=sim,
            raw=item,
        )

    async def alert_stream(self) -> AsyncIterator[dict]:
        """Consume /ISAPI/Event/notification/alertStream (multipart).

        Yields raw JSON-ish event payloads. The caller decides how to map them.
        Raises ISAPIError if the device/firmware does not support the stream.
        """
        path = "/ISAPI/Event/notification/alertStream"
        try:
            async with self._client(stream=True) as client:
                async with client.stream("GET", path) as resp:
                    if resp.status_code >= 400:
                        raise ISAPIError(
                            f"alertStream qo'llab-quvvatlanmaydi ({resp.status_code})",
                            resp.status_code,
                        )
                    buffer = ""
                    async for chunk in resp.aiter_text():
                        buffer += chunk
                        # naive multipart split on JSON objects
                        while True:
                            start = buffer.find("{")
                            if start == -1:
                                buffer = ""
                                break
                            # try to find balanced braces
                            depth = 0
                            end = -1
                            for i, ch in enumerate(buffer[start:], start):
                                if ch == "{":
                                    depth += 1
                                elif ch == "}":
                                    depth -= 1
                                    if depth == 0:
                                        end = i + 1
                                        break
                            if end == -1:
                                buffer = buffer[start:]
                                break
                            payload = buffer[start:end]
                            buffer = buffer[end:]
                            try:
                                import json as _json
                                yield _json.loads(payload)
                            except Exception:
                                continue
        except httpx.HTTPError as exc:
            raise ISAPIError(f"alertStream uzildi: {type(exc).__name__}") from exc

    async def close(self) -> None:
        pass  # clients are short-lived