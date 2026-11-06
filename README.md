# Ephemeral

[![Deploy to GitHub Pages](https://github.com/eagnespuerto/ephemeral/actions/workflows/pages.yml/badge.svg)](https://github.com/eagnespuerto/ephemeral/actions/workflows/pages.yml)
[![Live site](https://img.shields.io/badge/live-eagnespuerto.github.io%2Fephemeral-ffb347?logo=githubpages&logoColor=white)](https://eagnespuerto.github.io/ephemeral/)
[![JPL Scout](https://img.shields.io/badge/JPL%20Scout-hourly%20snapshot-5ec8ff)](https://cneos.jpl.nasa.gov/scout/)
[![No build step](https://img.shields.io/badge/build-none%20(vanilla%20JS)-9be15d)](#run-it-locally)
[![Astronomy Engine](https://img.shields.io/badge/powered%20by-Astronomy%20Engine-c39bff)](https://github.com/cosinekitty/astronomy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A Desmos-style plotter for the sky.** Paste an ephemeris and see the object:

- **a) from the discovery site**, as the discoverers saw it,
- **b) from where you are**, and
- **c) in Space View**, as an orbit arc around the Sun.

If the object has a name, Ephemeral pings **JPL Scout** for its tentative orbit and draws the orbit samples as an uncertainty cloud.

**Open it:** https://eagnespuerto.github.io/ephemeral/

![Ephemeral overview: 2024 YR4 at discovery from ATLAS Chile (W68)](docs/screenshots/overview.png)

## Screenshots

| Discovery POV | Sky chart |
|---|---|
| ![All-sky dome from ATLAS Chile at the discovery of 2024 YR4](docs/screenshots/discovery-pov.png) | ![Zoomable RA/Dec chart with the 2024 YR4 track and date ticks](docs/screenshots/sky-chart.png) |
| **2024 YR4 from W68**, 2024 Dec 27 04:00 UTC. Alt 34.4°, matching Horizons to 0.03°. | **RA/Dec chart.** Drag to pan, scroll to zoom. Dashed tracks show parallax per site. |

**Space View with a live Scout object.** The faint lines are Scout's orbit samples. The arc in orange is 2024 YR4, built from RA, Dec and Δ.

![Space View with Scout orbit samples for a NEOCP object](docs/screenshots/space-view.png)

## What it does

| Panel | What you see |
|---|---|
| **Discovery POV** | All-sky dome from the discovery site (MPC code), with stars, constellations, Sun, Moon and twilight colour. |
| **Your POV** | The same dome from your location. Use the browser location, type lat/lon, or give an MPC code. |
| **Sky chart** | Zoomable RA/Dec chart (gnomonic). Shows the geocentric track with daily ticks, topocentric tracks per site, and the Scout cloud. |
| **Space View** | Heliocentric ecliptic scene with the planets. The ephemeris becomes a 3D arc. Drag to turn, scroll to zoom, centre on the Sun or Earth. |

Other things:

- A **time slider** with play and speed controls, plus *Now* and *Discovery* buttons.
- **Many objects at once**, each with its own colour, like expressions in Desmos.
- **Share link**: the whole session goes into the URL, compressed. Your own location is left out.
- **Live Scout list**: pick any object now on the NEO Confirmation Page and see its orbit samples.

## Pasting an ephemeris

Ephemeral reads these formats:

- **JPL Horizons** observer tables, as text or CSV. It reads the target name, the observing site and Δ. A topocentric table is turned back into geocentric, so the other site's view is right.
- **MPC Ephemeris Service** and **Find_Orb** output.
- **MPC 80-column astrometry**. The `*` discovery line sets the discovery site and time.
- **Simple tables** such as `2026-11-07T00:00Z, 59.30, -16.03, 0.12` (time, RA, Dec, Δ). Time can be ISO, MPC style or a Julian date.

Sexagesimal RA is in hours; decimal RA is in degrees. Positions are taken as J2000. Without a Δ column you still get the sky views, but not the Space View arc or parallax.

## JPL Scout and CORS

The Scout API sends no CORS headers, so a web page on another site cannot read it. Ephemeral tries three sources in order:

1. **Your own proxy**, if you set one under *Scout proxy*. [`worker/scout-proxy.js`](worker/scout-proxy.js) is a small Cloudflare Worker that only talks to Scout.
2. **A direct call**, in case JPL turns on CORS later.
3. **The hourly snapshot.** The [Pages workflow](.github/workflows/pages.yml) runs [`tools/fetch_scout.py`](tools/fetch_scout.py) every hour. It saves every Scout object with 60 orbit samples and deploys them with the site.

Scout only covers unconfirmed objects on the NEO Confirmation Page. Designated objects such as 2024 YR4 are not on it, and the card says so.

## Accuracy

These are the checks we ran on 2024 YR4 at 2024 Dec 27 04:00 UTC, against JPL Horizons (airless alt/az):

| Site | Ephemeral | Horizons |
|---|---|---|
| W68 ATLAS Chile | alt 34.40°, az 67.41° | alt 34.37°, az 67.44° |
| Manila (from the W68 table, via parallax) | alt −50.25°, az 286.77° | alt −50.27°, az 286.78° |

The small differences come from linear interpolation between 6-hour rows.

Scout orbit samples are propagated as plain two-body orbits. For a Scout object 0.04 au away, this lands within about 1′ of Scout's own ephemeris. That is fine for a picture, but **don't use it to point a telescope**. Use the Scout or NEOCP ephemeris for that.

## Run it locally

There is no build step.

```bash
git clone https://github.com/eagnespuerto/ephemeral.git
```

```bash
cd ephemeral && python tools/fetch_scout.py && python -m http.server 8765
```

Then open http://localhost:8765. To regenerate the screenshots (needs Python Playwright and Microsoft Edge):

```bash
python tools/screenshots.py
```

[`tools/build_static_data.py`](tools/build_static_data.py) rebuilds the star, constellation and observatory-code files.

## Layout

```
index.html            page shell
css/style.css
js/parse.js           ephemeris formats -> rows
js/astro.js           frames, parallax, Kepler propagation (on Astronomy Engine)
js/model.js           objects, tracks, Scout clouds
js/dome.js            Discovery POV / Your POV
js/chart.js           RA/Dec chart
js/space.js           Space View
js/scout.js           Scout lookup (proxy -> live -> snapshot)
data/                 stars, constellation lines, MPC obscodes, sample ephemeris
tools/                data and Scout snapshot scripts, screenshots
worker/               optional Cloudflare Worker proxy
```

## Credits

- Positions of the Sun, Moon, planets and observers: [Astronomy Engine](https://github.com/cosinekitty/astronomy) by Don Cross (MIT).
- Stars to V = 6 and constellation lines: [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn (BSD-3, see [`data/LICENSE-d3-celestial.txt`](data/LICENSE-d3-celestial.txt)).
- Observatory codes: [Minor Planet Center](https://www.minorplanetcenter.net/iau/lists/ObsCodes.html).
- Tentative orbits: [NASA/JPL CNEOS Scout](https://cneos.jpl.nasa.gov/scout/).
- Sample ephemeris: [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/).

## License

[MIT](LICENSE) © 2026 Ella Agnes Puerto
