"""Build compact data files used by the site.

stars.json        [ra_deg, dec_deg, mag, bv] for stars to V=6 (from d3-celestial, BSD-3)
constellations.json  list of polylines [[ra,dec],...] (from d3-celestial, BSD-3)
obscodes.json     {code: [name, lon_deg_east, lat_geodetic_deg, height_m]} from the MPC list
"""
import json, math, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SRC = "https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/"
MPC = "https://www.minorplanetcenter.net/iau/lists/ObsCodes.html"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "ephemeral-build/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def ra360(x):
    return round(x % 360.0, 4)


def stars():
    js = json.loads(get(SRC + "stars.6.json"))
    out = []
    for f in js["features"]:
        ra, dec = f["geometry"]["coordinates"]
        bv = f["properties"].get("bv")
        try:
            bv = round(float(bv), 2)
        except (TypeError, ValueError):
            bv = 0.6
        out.append([ra360(ra), round(dec, 4), f["properties"]["mag"], bv])
    out.sort(key=lambda s: s[2])
    (DATA / "stars.json").write_text(json.dumps(out, separators=(",", ":")))
    print("stars", len(out))


def constellations():
    js = json.loads(get(SRC + "constellations.lines.json"))
    lines = []
    for f in js["features"]:
        for line in f["geometry"]["coordinates"]:
            lines.append([[ra360(p[0]), round(p[1], 3)] for p in line])
    (DATA / "constellations.json").write_text(json.dumps(lines, separators=(",", ":")))
    print("constellation lines", len(lines))


def geodetic(rho_cos, rho_sin):
    """Parallax constants (Earth radii) -> geodetic latitude (deg), height (m). WGS84."""
    a, f = 6378137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    p, z = rho_cos * a, rho_sin * a
    lat = math.atan2(z, p * (1 - e2))
    for _ in range(10):
        n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        h = p / math.cos(lat) - n if abs(lat) < 1.5 else z / math.sin(lat) - n * (1 - e2)
        lat = math.atan2(z, p * (1 - e2 * n / (n + h)))
    return math.degrees(lat), h


def obscodes():
    txt = get(MPC)
    out = {}
    for line in txt.splitlines():
        if len(line) < 30 or not re.match(r"^[0-9A-Z]{3}\s", line):
            continue
        code = line[0:3]
        try:
            lon = float(line[4:13]); c = float(line[13:21]); s = float(line[21:30])
        except ValueError:
            continue  # space-based / roving observatories have no fixed site
        name = line[30:].strip()
        if c == 0 and s == 0:
            continue  # geocentre (500) and similar
        lat, h = geodetic(c, s)
        out[code] = [name, round(lon, 5), round(lat, 5), round(h)]
    (DATA / "obscodes.json").write_text(json.dumps(out, separators=(",", ":")))
    print("obscodes", len(out))


if __name__ == "__main__":
    what = sys.argv[1:] or ["stars", "constellations", "obscodes"]
    for w in what:
        globals()[w]()
