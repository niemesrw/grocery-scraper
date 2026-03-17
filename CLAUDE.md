# grocery-scraper

Kroger purchase history scraper. Outputs JSON with item names, prices, quantities, and UPCs.

## Project structure

- `kroger-scraper.py` — Main scraper (Playwright, Python). Resumable, batched, human-paced.
- `kroger-scraper.js` — Browser console alternative (paste into DevTools).
- `kroger-purchases.json` — Output data (gitignored).
- `kroger-order-urls.json` — Cached order URLs (gitignored).

## Key patterns

- Detail pages at `/mypurchases/detail/{id}` are the reliable data source. Receipt pages (`/mypurchases/image/{id}`) are unreliable and should not be used.
- Items are extracted from detail page DOM using `[data-testid="cart-page-item-description"]` selectors. UPCs come from product link URLs (`a[href*="/p/"]`).
- Kroger blocks Playwright/Puppeteer automation. Use the Chrome plugin with iframe-based scraping instead (see `skills/kroger-scraper/` or `SCRAPING-NOTES.md`).
- Kroger will block scraping if requests are too fast. Use randomized delays (3-8s between orders).

## Running

```bash
uv run --with playwright kroger-scraper.py 15
```

Requires manual login in the browser window. Saves after each order. Re-run to continue.

## Downstream consumer

[pantry-agent](https://github.com/BLANXLAIT/pantry-agent) MCP server. The `add_to_cart` tool takes 13-digit UPCs — the `upc` field in output maps directly to this.
