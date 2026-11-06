"""Snapshot JPL Scout into data/scout/ so the static site can read it same-origin.

The Scout API sends no CORS headers, so browsers cannot call it directly.
A scheduled GitHub Action runs this script and deploys the result with the site.

data/scout/index.json   {"fetched": ISO, "objects": [summary rows]}
data/scout/<name>.json  full Scout reply for one object, with orbit samples
"""
import json, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://ssd-api.jpl.nasa.gov/scout.api"
OUT = Path(__file__).resolve().parents[1] / "data" / "scout"
N_ORBITS = 60


def get(params=None):
    url = API + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"User-Agent": "ephemeral-scout-snapshot/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as exc:  # noqa: BLE001 - retry any network error
            if attempt == 2:
                raise
            print("retry", url, exc, file=sys.stderr)
            time.sleep(5)


def safe(name):
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    listing = get()
    rows = listing.get("data", [])
    for old in OUT.glob("*.json"):
        old.unlink()
    ok = 0
    for row in rows:
        name = row["objectName"]
        try:
            full = get({"tdes": name, "orbits": 1, "n-orbits": N_ORBITS})
        except Exception as exc:  # noqa: BLE001
            print("skip", name, exc, file=sys.stderr)
            continue
        (OUT / f"{safe(name)}.json").write_text(json.dumps(full, separators=(",", ":")))
        ok += 1
        time.sleep(0.3)  # be polite to JPL
    index = {
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "NASA/JPL Scout API",
        "objects": rows,
    }
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"scout: {len(rows)} listed, {ok} with orbit samples")


if __name__ == "__main__":
    main()
