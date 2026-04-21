from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from urllib.parse import urlsplit


APP_NAME = os.getenv("APP_NAME", "lifeline-wave-1-pilot")
APP_BIND_HOST = os.getenv("APP_BIND_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "3000"))
APP_HEALTH_PATH = os.getenv("APP_HEALTH_PATH", "/healthz")
APP_MESSAGE = os.getenv("APP_MESSAGE", "lifeline wave 1 pilot ready")


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True).encode("utf-8")


class HealthHandler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == APP_HEALTH_PATH:
            self._send(
                200,
                {
                    "message": APP_MESSAGE,
                    "name": APP_NAME,
                    "path": path,
                    "status": "ok",
                },
            )
            return

        if path == "/":
            self._send(
                200,
                {
                    "message": APP_MESSAGE,
                    "name": APP_NAME,
                    "path": path,
                    "status": "ready",
                },
            )
            return

        self._send(
            404,
            {
                "name": APP_NAME,
                "path": path,
                "status": "not-found",
            },
        )

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        return


def main() -> None:
    server = HTTPServer((APP_BIND_HOST, APP_PORT), HealthHandler)
    print(f"{APP_NAME} listening on {APP_BIND_HOST}:{APP_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
