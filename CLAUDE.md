# grocery-scraper

Kroger purchase history scraper. Outputs JSON with item names, prices, quantities, and UPCs.

## Project structure

- `kroger-scraper.py` — Main scraper (Playwright, Python). Resumable, batched, human-paced.
- `kroger-scraper.js` — Browser console alternative (paste into DevTools).
- `kroger-purchases.json` — Output data (gitignored).
- `kroger-order-urls.json` — Cached order URLs (gitignored).

## Key patterns

- Receipt pages are at `/mypurchases/image/{id}` (not `/detail/{id}`).
- Items are delimited by `UPC: <digits>` on receipt pages. The text block _before_ each UPC marker contains that item's name/price/quantity.
- Older receipts may lack UPC markers — fallback parser splits on price lines but won't have UPCs.
- `SKIP_PREFIXES` filters out navigation chrome, footer text, and store-specific strings from receipt text.
- Kroger will block scraping if requests are too fast. The scraper uses randomized delays (2-8s) and human-like scrolling.

## Running

```bash
uv run --with playwright kroger-scraper.py 15
```

Requires manual login in the browser window. Saves after each order. Re-run to continue.

## Downstream consumer

[pantry-agent](https://github.com/BLANXLAIT/pantry-agent) MCP server. The `add_to_cart` tool takes 13-digit UPCs — the `upc` field in output maps directly to this.
