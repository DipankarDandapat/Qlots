# Deploying Qlots API to cPanel Shared Hosting (Hostingial)

cPanel uses Phusion Passenger which is WSGI-only. FastAPI is ASGI.
The solution is to run uvicorn in a background thread and proxy requests to it from a WSGI shim.

---

## Files required on the server

| File | Purpose |
|------|---------|
| `wsgi_app.py` | WSGI entry point — starts uvicorn in a thread and proxies requests |
| `passenger_wsgi.py` | Passenger loader — imports `application` from `wsgi_app.py` |
| `requirements.txt` | Runtime dependencies (no `psycopg2-binary`, no `pytest`) |
| `.env` | Environment variables for the app |
| `qlots.db` | SQLite database file |

---

## cPanel Web Application settings

| Field | Value |
|-------|-------|
| Python version | 3.10.x |
| Application root | `one.qlots.in` (folder where files are uploaded) |
| Application startup file | `wsgi_app.py` |
| Application entry point | `application` |
| Configuration file | `requirements.txt` |

---

## `wsgi_app.py` (the working version)

This is the file that must exist in the application root on the server.
The key insight: **do not sleep or import uvicorn at module level** — Passenger kills processes that take too long to start. Instead, start uvicorn lazily on the first request.

```python
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

def _ensure_started():
    global _started
    with _lock:
        if _started:
            return
        import uvicorn
        from main import app as asgi_app
        t = threading.Thread(target=lambda: uvicorn.run(asgi_app, host="127.0.0.1", port=PORT, log_level="error"), daemon=True)
        t.start()
        time.sleep(2)
        _started = True

def application(environ, start_response):
    import urllib.request
    _ensure_started()
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
        with urllib.request.urlopen(req, timeout=25) as resp:
            status = f"{resp.status} {resp.reason}"
            headers = [(k, v) for k, v in resp.headers.items()]
            start_response(status, headers)
            return [resp.read()]
    except Exception as e:
        err = str(e).encode()
        start_response("500 Internal Server Error", [("Content-Type", "text/plain"), ("Content-Length", str(len(err)))])
        return [err]
```

---

## `passenger_wsgi.py`

```python
from wsgi_app import application
```

---

## `requirements.txt` for cPanel (runtime only)

```
fastapi>=0.115.6
uvicorn==0.32.1
sqlalchemy==2.0.54
pydantic[email]>=2.11
email-validator>=2.2.0
reportlab==4.2.5
PyJWT==2.10.1
a2wsgi==1.10.10
anyio>=3.7.1
```

> Do not include `psycopg2-binary`, `pytest`, or `httpx` — these are not needed at runtime and `psycopg2-binary` will fail to install on shared hosting.

---

## `.env` on the server

Create this file in the application root folder:

```
APP_ENV=development
DATABASE_URL=sqlite:///./qlots.db
JWT_SECRET=replace-with-a-long-random-secret
TOKEN_HOURS=24
CORS_ORIGINS=*
```

---

## Deploy steps

1. Upload all backend files to the application root folder (`one.qlots.in/`) via cPanel File Manager
2. Make sure `qlots.db` and `.env` are present in the folder
3. In cPanel Web Applications, click **Run Pip Install** to install dependencies
4. Click **SAVE** to restart Passenger
5. To force a restart manually via SSH:
   ```bash
   touch ~/one.qlots.in/tmp/restart.txt
   ```
6. Verify the API is running:
   ```bash
   curl -s https://one.qlots.in/health
   # expected: {"status":"ok","service":"qlots-api","environment":"development","db":"ok"}
   ```
7. Open `https://one.qlots.in/docs` in a browser for the interactive API documentation

---

## SSH access and virtualenv

cPanel creates a virtualenv automatically. To activate it for manual pip installs or debugging:

```bash
source ~/virtualenv/one.qlots.in/3.10/bin/activate
cd ~/one.qlots.in
python -c "from main import app; print('OK')"  # test app imports
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Timeout on first request | Normal — uvicorn starts on the first request and takes ~2s |
| 500 error | Check `~/one.qlots.in/stderr.log` via SSH: `cat ~/one.qlots.in/stderr.log` |
| Lock error on pip install | Wait 2-3 minutes and retry, or install manually via SSH (see below) |
| Port conflict | `wsgi_app.py` uses `find_free_port()` so each Passenger worker gets its own port automatically |
| `raise_app_exceptions` TypeError | Old `wsgi_app.py` on server — replace with the version above |

### Manual pip install via SSH

If "Run Pip Install" shows a lock error:

```bash
source ~/virtualenv/one.qlots.in/3.10/bin/activate
pip install fastapi uvicorn sqlalchemy "pydantic[email]" email-validator reportlab PyJWT a2wsgi anyio
```

### Check error log

```bash
cat ~/one.qlots.in/stderr.log
```
