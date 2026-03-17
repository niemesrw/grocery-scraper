---
name: kroger-scraper
description: Scrape Kroger purchase history (items, prices, quantities, UPCs) using the Chrome plugin with an iframe-based approach. Use this skill whenever the user wants to scrape Kroger purchases, extract grocery history from Kroger, update their purchase data, or mentions Kroger order history. Also use it if the user mentions grocery scraping, purchase history extraction, or UPC collection from Kroger.
---

# Kroger Purchase History Scraper

Extract item-level purchase history from Kroger's website — names, prices, quantities, and 13-digit UPCs — using the Claude in Chrome plugin to drive a real browser session.

## Why This Approach

Kroger aggressively detects and blocks automation tools like Playwright and Puppeteer. The only reliable method is using a real Chrome browser session via the Claude in Chrome plugin. The scraper uses hidden same-origin iframes to load order detail pages in the background, which avoids navigation and keeps the parent page stable.

## Prerequisites

- User must be logged into kroger.com in Chrome
- Claude in Chrome extension must be connected
- User should be on any kroger.com page (the scraper works from there)
- Call `tabs_context_mcp` first to get the tab ID before any browser tool calls

## Workflow

### Phase 1: Collect Order URLs

First, gather all order URLs from the purchase history pages.

1. Navigate to `https://www.kroger.com/mypurchases` in the Chrome tab
2. On each page, extract order links by running this JS:

```javascript
var links = [...document.querySelectorAll('a[href*="/mypurchases/detail/"]')];
var seen = new Set();
var orders = links.map(function(a) {
    var href = a.getAttribute('href');
    var url = href.startsWith('/') ? 'https://www.kroger.com' + href : href;
    if (seen.has(url)) return null;
    seen.add(url);
    var text = a.innerText;
    var typeM = text.match(/^(Delivery|In-store|Pickup|Fuel Center)/m);
    var dateM = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.\s*\d+,\s*\d{4})/);
    var totalM = text.match(/\$([\d,]+\.\d+)/);
    return { u: url, t: typeM?.[1] || '', d: dateM?.[1] || '', tot: totalM?.[1] || '' };
}).filter(Boolean);
JSON.stringify(orders);
```

3. Paginate through all history pages. Look for a "Next" or pagination button using `find` tool or by reading the page. Click it, wait for the page to load, then run the extraction JS again. Repeat until no more pages (the "Next" button is disabled or absent, or extraction returns 0 new URLs).

4. Filter out "Fuel Center" orders (they have no grocery items):

```javascript
orders = orders.filter(function(o) { return o.t !== 'Fuel Center'; });
```

5. Download collected URLs as a JSON file:

```javascript
var blob = new Blob([JSON.stringify(orders)], {type: 'application/json'});
var a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'kroger-order-urls.json';
a.click();
```

The user can then move the file from their Downloads folder to the project directory.

### Phase 2: Scrape Order Details via Iframes

This is the core scraping step. For each order URL, load it in a hidden iframe and extract items from the DOM.

**Important constraints:**
- Process orders in batches of 5-10 to avoid overwhelming the browser
- Add 3-8 second random delays between orders
- Wait 8 seconds after iframe load for JS rendering to complete
- Save progress to `localStorage` after each order so it's resumable

#### Injection Pattern

Inject the order queue into `localStorage` first (keeps the scraper script small):

```javascript
localStorage.setItem('kroger_order_queue', JSON.stringify(orderUrls));
```

Then inject the scraper:

```javascript
(function() {
    var queue = JSON.parse(localStorage.getItem('kroger_order_queue') || '[]');
    var results = JSON.parse(localStorage.getItem('kroger_claude_scrape') || '[]');
    var doneUrls = new Set(results.map(function(r) { return r.url; }));

    // Filter already-done
    queue = queue.filter(function(o) { return !doneUrls.has(o.u); });

    var batchSize = 5;
    var batch = queue.slice(0, batchSize);
    var idx = 0;

    function processNext() {
        if (idx >= batch.length) {
            window._scrapeStatus = 'done_batch';
            return;
        }
        var order = batch[idx];
        window._scrapeStatus = 'processing ' + (idx + 1) + '/' + batch.length;

        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;width:1px;height:1px;opacity:0';
        document.body.appendChild(iframe);
        iframe.src = order.u;

        setTimeout(function() {
            try {
                var doc = iframe.contentDocument;
                var descs = doc.querySelectorAll('[data-testid="cart-page-item-description"]');
                var items = [...descs].map(function(el) {
                    var container = el.closest('li, article') || el.parentElement.parentElement.parentElement.parentElement;
                    var link = container.querySelector('a[href*="/p/"]');
                    var upc = link ? (link.href.match(/(\d{13})$/) || [])[1] || '' : '';
                    var text = container.innerText || '';
                    var price = (text.match(/Paid:\s*\$?([\d.]+)/) || [])[1];
                    var qty = (text.match(/Received:\s*(\d+)/) || [])[1];
                    return {
                        name: el.innerText.trim(),
                        upc: upc,
                        price: parseFloat(price) || 0,
                        quantity: parseInt(qty) || 1
                    };
                }).filter(function(i) { return i.name && i.price > 0; });

                results.push({
                    url: order.u,
                    type: order.t,
                    date: order.d,
                    total: order.tot,
                    items: items
                });
                localStorage.setItem('kroger_claude_scrape', JSON.stringify(results));
            } catch (e) {
                window._scrapeError = e.message;
            }
            iframe.remove();
            idx++;
            var delay = 3000 + Math.random() * 5000;
            setTimeout(processNext, delay);
        }, 8000); // Wait 8s for iframe JS rendering
    }

    processNext();
})();
```

#### Monitoring Progress

After injecting, poll for status:

```javascript
window._scrapeStatus
```

When it returns `'done_batch'`, check how many orders are done:

```javascript
JSON.parse(localStorage.getItem('kroger_claude_scrape') || '[]').length
```

Re-inject the same scraper script to process the next batch — it reads the queue from localStorage and automatically skips already-completed orders. Repeat until all orders are processed.

If `window._scrapeStatus` stays stuck on `'processing N/M'` for over 2 minutes, the iframe may have failed to load. Remove the stuck iframe and re-inject the scraper to retry.

### Phase 3: Export Data

The scraped data lives in `localStorage` under key `kroger_claude_scrape`. To export it:

```javascript
var data = localStorage.getItem('kroger_claude_scrape');
var blob = new Blob([data], {type: 'application/json'});
var a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'kroger-purchases.json';
a.click();
```

This triggers a browser download. The user can then move the file to their project directory.

## DOM Structure Reference

Detail pages (`/mypurchases/detail/{id}`) use this structure:

```
[data-testid="cart-page-item-description"]  ->  Item name
  parent container (li or article)
       a[href*="/p/"]  ->  Product link with 13-digit UPC at end of URL path
       innerText contains:
            "Paid: $X.XX"     ->  Price paid
            "Received: N"     ->  Quantity received
```

- Produce items sold by weight may lack "Received: N" — default quantity to 1
- Every item with a product link has a 13-digit UPC in the URL
- Receipt pages (`/mypurchases/image/`) are unreliable and should NOT be used

## Output Format

```json
{
  "url": "https://www.kroger.com/mypurchases/detail/...",
  "type": "Delivery",
  "date": "Feb. 14, 2026",
  "total": "248.67",
  "items": [
    {
      "name": "a2 Milk 2% Reduced Fat Milk",
      "upc": "0081326702007",
      "price": 4.99,
      "quantity": 1
    }
  ]
}
```

## Troubleshooting

- **Iframe returns empty items**: The page needs more render time. Increase the 8-second wait to 12 seconds.
- **Cross-origin error**: Make sure the parent page is on kroger.com (same origin required for iframe DOM access).
- **Rate limiting / empty pages**: Increase delays between orders. 5-10 second random delays usually work.
- **Large queues crash the browser**: Don't inject more than ~50 order URLs into localStorage at once. Split into chunks.
- **Data too large to pull via Chrome plugin**: Use the blob download approach in Phase 3 rather than trying to read localStorage directly.
- **Session expired mid-scrape**: If orders start returning login pages, the user needs to log back in. Progress is saved in localStorage so re-injecting the scraper will resume where it left off.
- **Scraper hangs**: If `window._scrapeStatus` is stuck, run `document.querySelectorAll('iframe').forEach(f => f.remove())` to clean up, then re-inject the scraper.

## Downstream Consumer

The [pantry-agent](https://github.com/BLANXLAIT/pantry-agent) MCP server's `add_to_cart` tool takes 13-digit UPCs — the `upc` field maps directly to this.
