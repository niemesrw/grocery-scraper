# Kroger Purchase History Scraping: Findings & Approach

## Goal

Extract item-level purchase history (name, price, quantity, UPC) from Kroger's online purchase history for use with the [pantry-agent](https://github.com/BLANXLAIT/pantry-agent) MCP server.

## Final Results

- **123 orders** scraped (Oct 2024 - Jan 2026)
- **2,111 items** with complete data
- **100% UPC coverage** (13-digit UPCs for every item)
- 47 Fuel Center orders skipped (no grocery items)
- 10 orders with no extractable items filtered out

## What We Tried (and What Failed)

### Attempt 1: Receipt Pages with Text Parsing

**Approach:** Navigate to `/mypurchases/image/{id}` receipt pages using Playwright, extract the full page text, and parse items using regex patterns (splitting on `UPC:` markers or price lines).

**Problems:**
- Receipt pages are unreliable under load — frequently return "problem loading the receipt"
- Kroger aggressively rate-limits automated requests to receipt pages
- Text parsing was fragile: required a large `SKIP_PREFIXES` list to filter navigation chrome, footer text, and store-specific strings
- Older receipts sometimes lacked UPC markers entirely, requiring a fallback parser

### Attempt 2: Receipt Pages with Longer Delays

**Approach:** Increased delays between requests (10-20s pre-receipt, 15-25s retry), added retry logic for failed receipts, tried `networkidle` wait strategy.

**Problems:**
- `networkidle` caused 30-second goto timeouts (Kroger pages never stop making requests)
- Even with 20+ second delays, receipt pages kept returning "problem loading the receipt"
- Kroger was clearly detecting and throttling Playwright automation

### Attempt 3: Looking for Undocumented APIs

**Approach:** Inspected network requests on Kroger pages using Chrome DevTools to find API endpoints that return structured data.

**Finding:** No useful undocumented API found for item-level data. However, this investigation led to discovering the detail page DOM structure.

### Attempt 4: Detail Pages with Playwright

**Approach:** Discovered that `/mypurchases/detail/{id}` pages have structured DOM with `data-testid` attributes. Rewrote the scraper to use `page.evaluate()` for DOM extraction instead of text parsing.

**Problems:**
- Playwright connections were still getting killed by Kroger
- The automation detection wasn't specific to receipt pages — Kroger was blocking the Playwright browser itself

### Attempt 5: Claude in Chrome Plugin (Manual) - SUCCESS

**Approach:** Used the Claude Code Chrome plugin to interact with the user's real Chrome browser session. This bypasses automation detection because it's a real browser with real cookies/session.

**Result:** Successfully scraped 5 orders with no rate limiting. Proved the approach works.

### Attempt 6: Autonomous iframe-based Scraper via Chrome Plugin - FINAL SOLUTION

**Approach:** Injected JavaScript into the browser via the Chrome plugin that:
1. Creates a hidden `<iframe>` on the current Kroger page
2. Loads each order's detail page URL into the iframe
3. Waits 8 seconds for JS rendering
4. Extracts items from the iframe's `contentDocument` (same-origin, so full DOM access)
5. Saves results to `localStorage` after each order
6. Adds 3-8 second random delays between orders

**Why it works:**
- Same-origin iframes give full DOM access without navigation (no script context loss)
- The parent page stays stable while iframes load in the background
- Real Chrome browser session avoids automation detection
- `localStorage` provides persistence — resumable if interrupted
- Randomized delays prevent rate limiting

## Key Technical Details

### Detail Page DOM Structure

```
[data-testid="cart-page-item-description"]  →  Item name
  └─ parent container (li or article)
       ├─ a[href*="/p/"]  →  Product link with 13-digit UPC in URL path
       └─ innerText contains:
            ├─ "Paid: $X.XX"     →  Price paid
            └─ "Received: N"     →  Quantity received
```

### Extraction JavaScript

```javascript
var descs = [...doc.querySelectorAll('[data-testid="cart-page-item-description"]')];
var items = descs.map(function(el) {
    var container = el.closest('li, article');
    var link = container.querySelector('a[href*="/p/"]');
    var upc = link.href.match(/(\d{13})$/)?.[1] || '';
    var text = container.innerText;
    var price = (text.match(/Paid:\s*\$?([\d.]+)/) || [])[1];
    var qty = (text.match(/Received:\s*(\d+)/) || [])[1];
    return { name: el.innerText.trim(), upc, price: parseFloat(price), quantity: parseInt(qty) || 1 };
}).filter(i => i.name && i.price > 0);
```

### Data Storage

- Order URLs cached in `kroger-order-urls.json` (222 orders, collected from purchase history pagination)
- Scrape progress saved to `localStorage` key `kroger_claude_scrape` (resumable)
- Final output in `kroger-purchases.json`

### Output Format

```json
{
  "url": "https://www.kroger.com/mypurchases/detail/...",
  "type": "Delivery",
  "date": "Feb. 14, 2026",
  "total": "248.67",
  "items": [
    {
      "name": "a2 Milk® 2% Reduced Fat Milk",
      "upc": "0081326702007",
      "price": 4.99,
      "quantity": 1
    }
  ]
}
```

## Lessons Learned

1. **Kroger actively detects and blocks Playwright/automation tools**, even with human-like delays and randomization. A real browser session is required.

2. **Receipt pages (`/image/`) are unreliable** — they frequently fail to load under any kind of automated access. Detail pages (`/detail/`) are much more robust.

3. **Detail pages are JS-rendered (SSR + client hydration)**, so `fetch()` + `DOMParser` won't work — the HTML returned by fetch doesn't contain the item data. You need actual browser rendering.

4. **Same-origin iframes are a powerful scraping technique** — they allow loading pages in the background without losing the parent page's script context, and provide full DOM access.

5. **`localStorage` is essential for long-running scrapes** — saving after each order makes the process fully resumable.

6. **The `data-testid` attributes are a goldmine** — they provide stable, semantic selectors that are much more reliable than CSS class names or XPath.
