#!/usr/bin/env python3
"""Local HTTPS static server for StarMap.

Why HTTPS: the app's service worker (offline cache), device-orientation
compass, camera and geolocation all require a "secure context". `localhost`
counts as secure, but a phone reaching this Mac over a LAN/hotspot IP on plain
HTTP does NOT — so the phone would silently get no sensors and could not install
the offline PWA. This serves the project over TLS with a self-signed cert whose
SAN matches the current IP, so the phone can trust it once and install.

Field use is fully offline: after the one-time install the phone runs the PWA
from its own cache; secure-context follows the https:// origin even with no
signal, so compass/camera/GPS keep working with no server and no network.

No third-party dependencies: Python stdlib + the system `openssl`.

Usage:  python3 tools/serve/serve.py [port]      (default port 8443)
"""
import http.server
import ipaddress
import os
import socket
import ssl
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CERT_DIR = Path(__file__).resolve().parent / "cert"
DEFAULT_PORT = 8443


def detect_lan_ip() -> str:
    """Best-effort source IP for the default route (no packets are sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip: str) -> tuple[Path, Path]:
    """Create/refresh a self-signed cert whose SAN covers `ip`, localhost, 127.0.0.1."""
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    crt, key, marker = CERT_DIR / "server.crt", CERT_DIR / "server.key", CERT_DIR / "san.txt"

    san_ips = ["127.0.0.1"]
    try:
        ipaddress.ip_address(ip)
        if ip not in san_ips:
            san_ips.append(ip)
    except ValueError:
        pass
    san = "DNS:localhost," + ",".join(f"IP:{a}" for a in san_ips)

    if crt.exists() and key.exists() and marker.exists() and marker.read_text().strip() == san:
        return crt, key

    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key), "-out", str(crt),
            "-days", "825",  # iOS rejects certs valid longer than 825 days
            "-subj", "/CN=StarMap Local",
            "-addext", f"subjectAltName={san}",
        ],
        check=True,
    )
    marker.write_text(san)
    return crt, key


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
        ".svg": "image/svg+xml",
        ".json": "application/json",
    }

    def end_headers(self):
        # Never let the dev server cache; the service worker owns caching.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    ip = detect_lan_ip()
    crt, key = ensure_cert(ip)
    os.chdir(PROJECT_ROOT)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(crt), keyfile=str(key))

    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    banner = (
        "StarMap — local HTTPS server\n"
        f"  On this Mac : https://localhost:{port}/\n"
        f"  On phone    : https://{ip}:{port}/\n"
        f"  Demo mode   : add ?demo=1 to either URL\n"
        f"  Cert to trust on phone: {crt}\n"
        "  (Ctrl-C to stop)\n"
    )
    print(banner, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
