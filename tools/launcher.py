"""Launch Glass Ribbons from the desktop icon.

Serves a fresh production build on a free localhost port, opens the browser,
and exits when the tab stops pinging. Closing the window closes the process.

    pythonw.exe tools/launcher.py

If src/ is newer than dist/, this rebuilds first. A failed build does not
fall back to the previous dist/.
"""

import http.server
import os
import subprocess
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SRC = os.path.join(ROOT, "src")

PING_PATH = "/__alive"
BYE_PATH = "/__bye"
IDLE_TIMEOUT = 20.0
PING_INTERVAL_MS = 3000

HEARTBEAT = """
<script>
(function () {
  var ping = function () {
    fetch('%s', { cache: 'no-store' }).catch(function () {});
  };
  ping();
  setInterval(ping, %d);
  addEventListener('pagehide', function () {
    navigator.sendBeacon('%s', '1');
  });
})();
</script>
""" % (PING_PATH, PING_INTERVAL_MS, BYE_PATH)


def alert(message):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, "Glass Ribbons", 0x10)
    except Exception:
        sys.stderr.write(message + "\n")


class State:
    last_ping = time.time()
    quitting = False


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def log_message(self, *args):
        pass

    def _no_content(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        if self.path.split("?")[0] == BYE_PATH:
            State.quitting = True
            self._no_content()
            return
        self.send_error(405)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == PING_PATH:
            State.last_ping = time.time()
            self._no_content()
            return
        if path in ("/", "/index.html"):
            self._serve_index()
            return
        super().do_GET()

    def _serve_index(self):
        index = os.path.join(DIST, "index.html")
        try:
            with open(index, "rb") as f:
                html = f.read().decode("utf-8")
        except OSError:
            self.send_error(404)
            return
        marker = "</body>"
        if marker in html:
            html = html.replace(marker, HEARTBEAT + marker, 1)
        else:
            html += HEARTBEAT
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def newest_source():
    latest = 0.0
    for name in ("index.html", "package.json", "vite.config.ts", "tsconfig.json"):
        path = os.path.join(ROOT, name)
        if os.path.isfile(path):
            latest = max(latest, os.path.getmtime(path))
    for dirpath, _, files in os.walk(SRC):
        for name in files:
            latest = max(latest, os.path.getmtime(os.path.join(dirpath, name)))
    return latest


def source_newer():
    index = os.path.join(DIST, "index.html")
    if not os.path.isfile(index):
        return True
    return newest_source() > os.path.getmtime(index) + 0.5


def build():
    npm = "npm.cmd" if os.name == "nt" else "npm"
    try:
        subprocess.run(
            [npm, "run", "build"],
            cwd=ROOT,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except FileNotFoundError:
        alert("Could not find npm.\n\nInstall Node.js, then run npm install in:\n" + ROOT)
        return False
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", "replace")[-700:]
        alert("The build failed, so the previous version was not opened.\n\n" + detail)
        return False
    return os.path.isfile(os.path.join(DIST, "index.html"))


def ensure_build():
    if not source_newer():
        return True
    return build()


def watchdog(httpd):
    while True:
        time.sleep(1.0)
        if State.quitting or time.time() - State.last_ping > IDLE_TIMEOUT:
            try:
                httpd.shutdown()
            finally:
                os._exit(0)


def main():
    if not ensure_build():
        return 1
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    State.last_ping = time.time()
    threading.Thread(target=watchdog, args=(httpd,), daemon=True).start()
    webbrowser.open("http://127.0.0.1:%d/" % port)
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
