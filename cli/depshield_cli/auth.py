from __future__ import annotations

import json
import secrets
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlencode, urlsplit, urlunsplit

SERVICE_NAME = "DepShield CLI"
MAX_AUTH_RESPONSE_BYTES = 16_384


class _AuthorizationServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address: tuple[str, int], state: str, origin: str) -> None:
        self.state = state
        self.origin = origin
        self.token: str | None = None
        self.finished = threading.Event()
        super().__init__(address, _AuthorizationHandler)


class _AuthorizationHandler(BaseHTTPRequestHandler):
    server: _AuthorizationServer

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/oauth/callback":
            self.send_error(404)
            return
        if self.headers.get("Origin") != self.server.origin:
            self.send_error(403)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if content_length <= 0 or content_length > MAX_AUTH_RESPONSE_BYTES:
            self.send_error(413)
            return
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_error(400)
            return
        if not isinstance(payload, dict) or payload.get("state") != self.server.state:
            self.send_error(403)
            return
        token = payload.get("token")
        if not isinstance(token, str) or not token or len(token) > 12_000:
            self.send_error(400)
            return

        self.server.token = token
        self.server.finished.set()
        body = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", self.server.origin)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def dashboard_origin(dashboard_url: str) -> str:
    parsed = urlsplit(dashboard_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Dashboard URL must use HTTP or HTTPS and include a host")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Dashboard URL must not include credentials, query, or fragment")
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


def receive_browser_token(
    dashboard_url: str,
    timeout_seconds: int = 300,
) -> str:
    origin = dashboard_origin(dashboard_url)
    state = secrets.token_urlsafe(32)
    server = _AuthorizationServer(("127.0.0.1", 0), state, origin)
    callback = f"http://127.0.0.1:{server.server_port}/oauth/callback"
    parsed = urlsplit(dashboard_url)
    authorization_url = urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urlencode({"depshield_callback": callback, "depshield_state": state}),
            "",
        )
    )
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        if not webbrowser.open(authorization_url):
            raise RuntimeError("Could not open the browser; open this URL manually:\n" + authorization_url)
        if not server.finished.wait(timeout_seconds):
            raise TimeoutError("Browser authorization timed out")
        if server.token is None:
            raise RuntimeError("Browser authorization completed without a token")
        return server.token
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=2)


def store_token(api_url: str, token: str) -> None:
    try:
        import keyring

        keyring.set_password(SERVICE_NAME, api_url, token)
    except Exception as exc:
        raise RuntimeError(
            "The operating-system credential store is unavailable; no token was saved"
        ) from exc


def get_token(api_url: str) -> str | None:
    try:
        import keyring

        return keyring.get_password(SERVICE_NAME, api_url)
    except Exception as exc:
        raise RuntimeError("Could not read the operating-system credential store") from exc


def delete_token(api_url: str) -> None:
    try:
        import keyring

        if keyring.get_password(SERVICE_NAME, api_url) is not None:
            keyring.delete_password(SERVICE_NAME, api_url)
    except Exception as exc:
        raise RuntimeError("Could not remove the token from the operating-system credential store") from exc
