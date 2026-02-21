// Kroger Purchase History Scraper - Browser Console Version
// Uses detail pages with DOM extraction (not receipt pages)
//
// HOW TO USE:
// 1. Open Chrome, go to kroger.com, make sure you're logged in
// 2. Open DevTools: Cmd+Option+J (Mac) or Ctrl+Shift+J (Windows)
// 3. First run: paste the SETUP block below to load order URLs
// 4. Then paste the SCRAPER block to start scraping
// 5. Watch the console for progress. It auto-saves after each order.
// 6. When done (or to check progress), paste the EXPORT block
//
// The scraper is resumable — if you close the tab, just paste the
// SCRAPER block again and it picks up where it left off.

// ============================================================
// STEP 1: SETUP - Run this first to load order URLs
// (Only needed once. Skip if you've already done this.)
// ============================================================

/*
// Paste this in console first:

fetch('/mypurchases?tab=purchases&page=1')
  .then(() => console.log('Loading order URLs...'));

// Then paste the scraper code from STEP 2
*/

// ============================================================
// STEP 2: SCRAPER - Paste this to start/resume scraping
// ============================================================

(async function krogerScraper() {
  const STORAGE_KEY = 'kroger_scrape_v2';
  const DELAY_MS = 8000; // 8 seconds between pages

  // Load state
  let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {
    orders: [],      // [{url, type, date, total}] - loaded from setup
    results: [],     // [{url, type, date, total, items: [...]}]
    currentIdx: 0,
    done: false
  };

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function extractItems() {
    const descs = [...document.querySelectorAll('[data-testid="cart-page-item-description"]')];
    return descs.map(el => {
      const container = el.closest('li, article') || el.parentElement?.parentElement?.parentElement?.parentElement;
      if (!container) return null;
      const link = container.querySelector('a[href*="/p/"]');
      const upcMatch = link?.href?.match(/(\d{13})$/);
      const text = container.innerText || '';
      const paidMatch = text.match(/Paid:\s*\$?([\d.]+)/);
      const receivedMatch = text.match(/Received:\s*(\d+)/);
      return {
        name: el.innerText.trim(),
        upc: upcMatch?.[1] || '',
        price: paidMatch ? parseFloat(paidMatch[1]) : 0,
        quantity: receivedMatch ? parseInt(receivedMatch[1]) : 1
      };
    }).filter(i => i && i.name && i.price > 0);
  }

  async function wait(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function waitForItems(maxWait = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (document.querySelector('[data-testid="cart-page-item-description"]')) return true;
      await wait(500);
    }
    return false;
  }

  // If no orders loaded, try to collect them from purchase history
  if (state.orders.length === 0) {
    console.log('%c[Scraper] No orders loaded. Collecting from purchase history...', 'color: orange; font-weight: bold');

    if (!location.href.includes('/mypurchases')) {
      location.href = '/mypurchases?tab=purchases&page=1';
      return;
    }

    // Collect order URLs from all pages
    for (let pg = 1; pg <= 30; pg++) {
      if (pg > 1) {
        await wait(3000);
        const resp = await fetch(`/mypurchases?tab=purchases&page=${pg}`);
        const html = await resp.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        var links = [...doc.querySelectorAll('a[href*="/mypurchases/detail/"]')];
      } else {
        var links = [...document.querySelectorAll('a[href*="/mypurchases/detail/"]')];
      }

      if (links.length === 0) break;

      const seen = new Set(state.orders.map(o => o.url));
      for (const a of links) {
        const href = a.getAttribute('href');
        const url = href.startsWith('/') ? `https://www.kroger.com${href}` : href;
        if (seen.has(url)) continue;
        seen.add(url);
        const text = a.innerText;
        const typeMatch = text.match(/^(Delivery|In-store|Pickup|Fuel Center)/m);
        const dateMatch = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.\s*\d+,\s*\d{4})/);
        const totalMatch = text.match(/\$([\d,]+\.\d+)/);
        if (typeMatch?.[1] === 'Fuel Center') continue;
        state.orders.push({
          url, type: typeMatch?.[1] || '', date: dateMatch?.[1] || '', total: totalMatch?.[1] || '0'
        });
      }
      console.log('[Scraper] Page %d: %d orders collected', pg, state.orders.length);
    }
    save();
    console.log('%c[Scraper] Collected %d orders. Starting scrape...', 'color: green; font-weight: bold', state.orders.length);
  }

  if (state.done) {
    console.log('%c[Scraper] Already done! %d orders scraped.', 'color: green; font-weight: bold', state.results.length);
    console.log('Run the EXPORT block to get your data.');
    return;
  }

  const total = state.orders.length;
  console.log('%c[Scraper] Starting from order %d/%d', 'color: cyan; font-weight: bold', state.currentIdx + 1, total);

  for (let i = state.currentIdx; i < total; i++) {
    const order = state.orders[i];
    state.currentIdx = i;

    // Navigate to order detail page
    try {
      // Use an iframe to avoid losing our script context
      const resp = await fetch(order.url, { credentials: 'include' });
      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract from parsed HTML
      const descs = [...doc.querySelectorAll('[data-testid="cart-page-item-description"]')];

      let items;
      if (descs.length > 0) {
        items = descs.map(el => {
          const container = el.closest('li, article') || el.parentElement?.parentElement?.parentElement?.parentElement;
          if (!container) return null;
          const link = container.querySelector('a[href*="/p/"]');
          const upcMatch = link?.href?.match(/(\d{13})$/);
          const text = container.innerText || '';
          const paidMatch = text.match(/Paid:\s*\$?([\d.]+)/);
          const receivedMatch = text.match(/Received:\s*(\d+)/);
          return {
            name: el.innerText.trim(),
            upc: upcMatch?.[1] || '',
            price: paidMatch ? parseFloat(paidMatch[1]) : 0,
            quantity: receivedMatch ? parseInt(receivedMatch[1]) : 1
          };
        }).filter(it => it && it.name && it.price > 0);
      } else {
        // Detail pages are JS-rendered, fetch won't have the items
        // Fall back to navigating the actual page
        items = null;
      }

      if (items === null || items.length === 0) {
        // Need to actually navigate to the page for JS rendering
        location.href = order.url;
        // Save current index so we resume here
        save();
        console.log('[Scraper] Navigating to order %d/%d for JS rendering. Re-paste the scraper after page loads.', i + 1, total);
        return;
      }

      state.results.push({
        url: order.url, type: order.type, date: order.date, total: order.total, items
      });
      state.currentIdx = i + 1;
      save();

      console.log('[Scraper] %d/%d: %s %s - %d items, $%s', i + 1, total, order.date, order.type, items.length, order.total);
    } catch (err) {
      console.error('[Scraper] Error on order %d: %s', i + 1, err.message);
      state.results.push({
        url: order.url, type: order.type, date: order.date, total: order.total, items: [], error: err.message
      });
      state.currentIdx = i + 1;
      save();
    }

    // Human-like delay
    await wait(DELAY_MS + Math.random() * 4000);
  }

  state.done = true;
  save();
  console.log('%c[Scraper] COMPLETE! %d orders scraped.', 'color: green; font-weight: bold; font-size: 16px', state.results.length);
  console.log('Run the EXPORT block to get your data.');
})();

// ============================================================
// STEP 3: EXPORT - Paste this when scraping is done (or anytime
// to check progress). It copies the JSON to your clipboard.
// ============================================================

/*
// Paste this in console to export:

const state = JSON.parse(localStorage.getItem('kroger_scrape_v2') || '{}');
const data = JSON.stringify(state.results || [], null, 2);
copy(data);
console.log('Copied %d orders to clipboard!', (state.results || []).length);
console.log('Paste into a file and save as kroger-purchases.json');
*/
