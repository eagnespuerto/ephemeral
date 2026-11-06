"""Regenerate README screenshots. Needs a local server on :8765 and Python Playwright.

    python -m http.server 8765        (in the repo root)
    python tools/screenshots.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = "http://localhost:8765/"
OUT = Path(__file__).resolve().parents[1] / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)


def enlarge(page, panel):
    page.click(f'.panel[data-panel="{panel}"] .max')
    page.wait_for_timeout(600)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page.goto(URL)
        page.wait_for_function("window.ephemeral && window.ephemeral.state.objects.length > 0")
        page.wait_for_timeout(1500)
        page.screenshot(path=OUT / "overview.png")

        enlarge(page, "disc")
        page.screenshot(path=OUT / "discovery-pov.png")
        enlarge(page, "disc")

        enlarge(page, "chart")
        page.screenshot(path=OUT / "sky-chart.png")
        enlarge(page, "chart")

        # a live Scout object: tentative orbit samples in Space View
        page.wait_for_function("document.querySelector('#scout-list').options.length > 1")
        page.select_option("#scout-list", index=1)
        page.wait_for_function("window.ephemeral.state.objects.at(-1).els.length > 0", timeout=20000)
        page.click("#btn-now")
        enlarge(page, "space")
        page.wait_for_timeout(800)
        page.screenshot(path=OUT / "space-view.png")
        # name search (needs tools/dev_proxy.py running on :8787)
        page.goto(URL)
        page.wait_for_function("window.ephemeral && window.ephemeral.state.objects.length > 0")
        page.evaluate("""() => { const p = document.querySelector('#proxy');
            p.value = 'http://localhost:8787'; p.dispatchEvent(new Event('change')); }""")
        page.click("#btn-add")
        card = page.locator("#objects .obj").last
        card.locator(".o-name").fill("Apophis")
        card.locator(".o-name").press("Enter")
        try:
            page.wait_for_function("(() => { const o = window.ephemeral.state.objects.at(-1); return o.results && ['horizons','mpc','scout'].every(k => o.results[k].status !== 'loading'); })()", timeout=60000)
            card.locator(".o-table summary").click()
            page.wait_for_timeout(800)
            page.screenshot(path=OUT / "name-search.png")
        except Exception as exc:  # proxy not running
            print("skipped name-search.png:", exc)
        browser.close()
    print("saved to", OUT)


if __name__ == "__main__":
    main()
