// Kroger Purchase History Scraper
// Run this in the browser console on kroger.com/mypurchases
// It navigates through all pages, clicks into each order, extracts items,
// then saves the result to localStorage. Progress survives page reloads.

(async function krogerScraper() {
  const STORAGE_KEY = 'kroger_scrape_data';
  const PHASE_KEY = 'kroger_scrape_phase';

  // Load or init state
  let state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {
    orderUrls: [],    // [{url, type, date, total}]
    orderDetails: [], // [{url, type, date, total, items: [{name, quantity, paid}]}]
    urlPage: 1,
    detailIdx: 0,
    done: false
  };
  let phase = localStorage.getItem(PHASE_KEY) || 'collect_urls';

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(PHASE_KEY, phase);
  }

  function extractOrderUrls() {
    const links = [...document.querySelectorAll('a[href*="/mypurchases/detail/"]')];
    const seen = new Set(state.orderUrls.map(o => o.url));
    for (const a of links) {
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      const text = a.innerText;
      const typeMatch = text.match(/^(Delivery|In-store|Pickup|Fuel Center)/m);
      const dateMatch = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.\s*\d+,\s*\d{4})/);
      const totalMatch = text.match(/\$([\d,]+\.\d+)/);
      state.orderUrls.push({
        url: a.href,
        type: typeMatch?.[1] || 'Unknown',
        date: dateMatch?.[1] || '',
        total: totalMatch?.[1] || '0'
      });
    }
  }

  function extractOrderItems() {
    const text = document.body.innerText;
    const orderNum = text.match(/Order Number:\s*(\d+)/)?.[1] || '';

    // Split by "Save to List" to get item blocks
    const blocks = text.split(/Save to List/);
    const items = [];
    for (const block of blocks) {
      const paidMatch = block.match(/Paid:\s*\$?([\d.]+)/);
      const receivedMatch = block.match(/Received:\s*(\d+)/);
      if (!paidMatch) continue;

      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 3);
      let name = '';
      for (const line of lines) {
        if (line.match(/^(Add |Delivery|In-store|SNAP|Everyday|\d+ (ct|oz|fl|lb|pk)|in Cart|discounted|Received|Paid|Save|Saved|\$|Skip to|View |Request|Refund|Order |Payment|Item |Tip |Total|American|Product|Looking|Visit|Purchase|Home|Pickup|Fuel|Completed|FREE|February|January|December|November|October|September|August|July|June|May|April|March|We have)/i)) continue;
        if (line.match(/^\d+\.\d+$/) || line.match(/^\+\d+$/) || line.match(/^\d+ Total/)) continue;
        if (line.length > 5) {
          name = line;
          break;
        }
      }
      if (name) {
        items.push({
          name,
          quantity: parseInt(receivedMatch?.[1] || '1'),
          paid: parseFloat(paidMatch[1])
        });
      }
    }
    return { orderNumber: orderNum, items };
  }

  // PHASE 1: Collect order URLs from purchase history pages
  if (phase === 'collect_urls') {
    const loc = location.href;
    if (loc.includes('/mypurchases') && !loc.includes('/detail/')) {
      extractOrderUrls();
      const currentPage = parseInt(new URLSearchParams(location.search).get('page') || '1');
      state.urlPage = currentPage;
      save();

      console.log(`[Kroger Scraper] Page ${currentPage}: Found ${state.orderUrls.length} total orders`);

      // Check if there's a next page
      const nextPageNum = currentPage + 1;
      const nextBtn = [...document.querySelectorAll('a, button')].find(el =>
        el.textContent.trim() === String(nextPageNum) || el.getAttribute('aria-label')?.includes('next')
      );

      if (nextPageNum <= 23) {
        // Navigate to next page
        setTimeout(() => {
          location.href = `/mypurchases?tab=purchases&page=${nextPageNum}`;
        }, 1000);
      } else {
        // Done collecting URLs, move to detail scraping
        console.log(`[Kroger Scraper] URL collection complete: ${state.orderUrls.length} orders`);
        phase = 'collect_details';
        state.detailIdx = 0;
        save();
        setTimeout(() => {
          location.href = state.orderUrls[0].url;
        }, 1000);
      }
    } else {
      // Not on the right page, navigate there
      location.href = `/mypurchases?tab=purchases&page=${state.urlPage || 1}`;
    }
  }

  // PHASE 2: Visit each order detail page and extract items
  else if (phase === 'collect_details') {
    const loc = location.href;
    if (loc.includes('/mypurchases/detail/')) {
      // Wait for page to fully load
      await new Promise(r => setTimeout(r, 2000));

      const { orderNumber, items } = extractOrderItems();
      const orderInfo = state.orderUrls[state.detailIdx];

      state.orderDetails.push({
        ...orderInfo,
        orderNumber,
        items
      });

      state.detailIdx++;
      save();

      console.log(`[Kroger Scraper] Order ${state.detailIdx}/${state.orderUrls.length}: ${items.length} items (${orderInfo.date} - ${orderInfo.type})`);

      if (state.detailIdx < state.orderUrls.length) {
        // Next order
        setTimeout(() => {
          location.href = state.orderUrls[state.detailIdx].url;
        }, 1500);
      } else {
        // All done!
        phase = 'done';
        state.done = true;
        save();
        console.log(`[Kroger Scraper] COMPLETE! ${state.orderDetails.length} orders scraped.`);
        console.log(`[Kroger Scraper] Run this to get your data: copy(localStorage.getItem('kroger_scrape_data'))`);
      }
    } else {
      // Navigate to the current order
      location.href = state.orderUrls[state.detailIdx]?.url || '/mypurchases';
    }
  }

  else if (phase === 'done') {
    console.log(`[Kroger Scraper] Already complete! ${state.orderDetails.length} orders.`);
    console.log(`Run: copy(localStorage.getItem('kroger_scrape_data'))`);
  }
})();
