"""Local stand-in for worker/ephemeral-proxy.js, for testing without Cloudflare.

    python tools/dev_proxy.py          # listens on http://localhost:8787

Then set Ephemeral's Proxy box to http://localhost:8787. Same routes as the Worker.
"""
import html
import json
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = {
    "/scout": "https://ssd-api.jpl.nasa.gov/scout.api",
    "/horizons": "https://ssd.jpl.nasa.gov/api/horizons.api",
    "/sbdb": "https://ssd-api.jpl.nasa.gov/sbdb.api",
}
MPC_EPH = "https://www.minorplanetcenter.net/cgi-bin/mpeph2.cgi"
UA = {"User-Agent": "ephemeral-dev-proxy/1.0"}


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def reply(self, status, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else body.encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        path, _, query = self.path.partition("?")
        path = path.rstrip("/") or "/"
        if path == "/":
            return self.reply(200, json.dumps({"ok": True, "service": "ephemeral-dev-proxy"}))
        if path not in UPSTREAM:
            return self.reply(404, json.dumps({"error": "Unknown route."}))
        req = urllib.request.Request(UPSTREAM[path] + ("?" + query if query else ""), headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return self.reply(r.status, r.read(), r.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as e:
            return self.reply(e.code, e.read())

    def do_POST(self):
        if self.path.rstrip("/") != "/mpc-eph":
            return self.reply(404, json.dumps({"error": "Unknown route."}))
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        req = urllib.request.Request(MPC_EPH, data=body, headers={**UA, "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=60) as r:
            page = r.read().decode("utf-8", "replace")
        m = re.search(r"<pre>([\s\S]*?)</pre>", page, re.I)
        if not m:
            msg = re.search(r"No object found[^.]*\.", re.sub(r"<[^>]*>", " ", page))
            return self.reply(404, json.dumps({"error": msg.group(0) if msg else "MPC returned no ephemeris."}))
        text = html.unescape(re.sub(r"<[^>]*>", "", m.group(1)))
        return self.reply(200, text, "text/plain; charset=utf-8")


if __name__ == "__main__":
    print("ephemeral dev proxy on http://localhost:8787")
    ThreadingHTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
