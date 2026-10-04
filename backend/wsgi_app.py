"""WSGI entry for cPanel / Phusion Passenger.

cPanel Passenger is WSGI-only. FastAPI is ASGI.
Uvicorn runs in a background daemon thread on a free port;
the WSGI callable proxies each request to it via urllib.
"""
import os
import sys
import threading
import socket
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))


def find_free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


PORT = find_free_port()
_started = False
_lock = threading.Lock()


def _wait_for_port(port, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


def _ensure_started():
    global _started
    with _lock:
        if _started:
            return
        import uvicorn
        from main import app as asgi_app
        t = threading.Thread(
            target=lambda: uvicorn.run(asgi_app, host="127.0.0.1", port=PORT, log_level="error"),
            daemon=True,
        )
        t.start()
        _wait_for_port(PORT, timeout=30)
        _started = True


def _proxy(environ, start_response, retry=True):
    import urllib.request
    import urllib.error
    path = environ.get('PATH_INFO', '/')
    qs = environ.get('QUERY_STRING', '')
    url = f"http://127.0.0.1:{PORT}{path}"
    if qs:
        url += "?" + qs
    method = environ.get('REQUEST_METHOD', 'GET')
    length = int(environ.get('CONTENT_LENGTH') or 0)
    body = environ['wsgi.input'].read(length) if length else None
    req = urllib.request.Request(url, data=body, method=method)
    for key, val in environ.items():
        if key.startswith('HTTP_'):
            req.add_header(key[5:].replace('_', '-').title(), val)
    ct = environ.get('CONTENT_TYPE', '')
    if ct:
        req.add_header('Content-Type', ct)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            status = f"{resp.status} {resp.reason}"
            headers = [(k, v) for k, v in resp.headers.items()]
            start_response(status, headers)
            return [resp.read()]
    except urllib.error.HTTPError as e:
        # FastAPI returned a real HTTP error (4xx/5xx) — pass it through
        body_bytes = e.read()
        status = f"{e.code} {e.reason}"
        headers = [(k, v) for k, v in e.headers.items()]
        start_response(status, headers)
        return [body_bytes]
    except Exception as e:
        # Connection error — uvicorn may have died, restart once and retry
        if retry:
            global _started
            with _lock:
                _started = False
            _ensure_started()
            return _proxy(environ, start_response, retry=False)
        err = str(e).encode()
        start_response("500 Internal Server Error", [
            ("Content-Type", "text/plain"),
            ("Content-Length", str(len(err))),
        ])
        return [err]


def application(environ, start_response):
    _ensure_started()
    return _proxy(environ, start_response)
