# grocery-scraper

Scrapes Kroger purchase history including item UPCs for use with [pantry-agent](https://github.com/BLANXLAIT/pantry-agent).

## Setup

```bash
uv venv && source .venv/bin/activate
uv pip install playwright
playwright install chromium
```

## Usage

### Python scraper (recommended)

Uses Playwright to open a real Chrome window. You log in manually, then it scrapes receipt pages in batches.

```bash
# Scrape 15 orders per run (default: 10)
uv run --with playwright kroger-scraper.py 15
```

The scraper is **resumable** — it saves progress after each order to `kroger-purchases.json`. Re-run to continue where you left off. Fuel Center orders are automatically skipped.

**Rate limiting:** The scraper uses randomized human-paced delays (2-8s between pages, random scrolling) to avoid detection. Batch size controls how many orders per session. If Kroger blocks you ("unable to retrieve"), stop and wait before retrying.

### Browser console scraper

Alternative lightweight scraper that runs directly in the browser console. Paste `kroger-scraper.js` into DevTools on `kroger.com/mypurchases`. Progress is stored in `localStorage`.

## How it works

1. **Phase 1 — Collect order URLs:** Paginates through `/mypurchases` to gather all order detail links. Cached to `kroger-order-urls.json` after first run.
2. **Phase 2 — Scrape receipts:** Visits each order's receipt page (`/mypurchases/image/...`) and parses item details.

### Receipt parsing

Two strategies for extracting items from receipt text:

1. **UPC splitting** (preferred): Splits the item section on `UPC: <digits>` markers. Captures the UPC for each item — these are 13-digit codes usable with the Kroger Cart API.
2. **Price-line splitting** (fallback): For older receipts without UPC markers, splits on `$X.XX` price lines.

## Output

### kroger-purchases.json

```json
[
  {
    "url": "https://www.kroger.com/mypurchases/detail/...",
    "type": "Delivery",
    "date": "Feb. 14, 2026",
    "total": "248.67",
    "orderNumber": "1260456456850549504",
    "orderType": "Delivery",
    "orderDate": "Feb. 14, 2026",
    "orderTotal": "248.67",
    "totalSavings": "51.91",
    "items": [
      {
        "name": "a2 Milk® Vitamin D Whole Milk, 59 fl oz",
        "quantity": 1,
        "price": 4.99,
        "upc": "0085239200100"
      }
    ]
  }
]
```

### kroger-order-urls.json

Cached list of order URLs to avoid re-scraping the purchase history pages. Delete this file to force a fresh URL collection.

## Integration with pantry-agent

The `upc` field from scraped items maps directly to the `add_to_cart` MCP tool's `upc` parameter (13-digit), enabling direct cart adds without searching by product name.
