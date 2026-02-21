#!/usr/bin/env python3
"""Kroger Purchase History Scraper - Human-paced receipt scraper."""
import json
import random
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

OUTPUT_FILE = Path(__file__).parent / "kroger-purchases.json"
URLS_FILE = Path(__file__).parent / "kroger-order-urls.json"


def human_wait(page, min_s=3, max_s=7):
    """Wait a random human-like duration."""
    ms = int(random.uniform(min_s, max_s) * 1000)
    page.wait_for_timeout(ms)


def human_scroll(page):
    """Scroll around a bit like a person reading the page."""
    scrolls = random.randint(1, 3)
    for _ in range(scrolls):
        page.evaluate(f"window.scrollBy(0, {random.randint(200, 600)})")
        human_wait(page, 0.5, 1.5)


def extract_order_urls(page):
    """Extract order URLs from a purchase history list page."""
    links = page.query_selector_all('a[href*="/mypurchases/detail/"]')
    seen = set()
    orders = []
    for a in links:
        href = a.get_attribute("href")
        url = f"https://www.kroger.com{href}" if href.startswith("/") else href
        if url in seen:
            continue
        seen.add(url)
        text = a.inner_text()
        type_m = re.search(r"^(Delivery|In-store|Pickup|Fuel Center)", text, re.M)
        date_m = re.search(
            r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.\s*\d+,\s*\d{4})",
            text,
        )
        total_m = re.search(r"\$([\d,]+\.\d+)", text)
        orders.append({
            "url": url,
            "receipt_url": url.replace("/detail/", "/image/"),
            "type": type_m[1] if type_m else "",
            "date": date_m[1] if date_m else "",
            "total": total_m[1] if total_m else "",
        })
    return orders


EXTRACT_ITEMS_JS = """
() => {
    const descs = [...document.querySelectorAll('[data-testid="cart-page-item-description"]')];
    return descs.map(el => {
        const container = el.closest('li, article') || el.parentElement.parentElement.parentElement.parentElement;
        const link = container.querySelector('a[href*="/p/"]');
        const upcMatch = link?.href?.match(/(\\d{13})$/);
        const text = container.innerText || '';
        const paidMatch = text.match(/Paid:\\s*\\$?([\\d.]+)/);
        const receivedMatch = text.match(/Received:\\s*(\\d+)/);
        return {
            name: el.innerText.trim(),
            upc: upcMatch?.[1] || '',
            price: paidMatch ? parseFloat(paidMatch[1]) : 0,
            quantity: receivedMatch ? parseInt(receivedMatch[1]) : 1
        };
    }).filter(i => i.name && i.price > 0);
}
"""


def load_existing():
    """Load existing results, keeping only good entries."""
    results = []
    done_urls = set()
    if OUTPUT_FILE.exists():
        try:
            existing = json.loads(OUTPUT_FILE.read_text())
            for r in existing:
                if not r.get("error"):
                    results.append(r)
                    done_urls.add(r["url"])
        except Exception:
            pass
    return results, done_urls


def main(batch_size=10):
    print("=" * 60, flush=True)
    print("Kroger Purchase History Scraper (human-paced)", flush=True)
    print(f"Batch size: {batch_size} orders", flush=True)
    print("=" * 60, flush=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
        )
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
        )
        page = context.new_page()

        page.goto("https://www.kroger.com/signin")
        print("\n>>> Log into Kroger in the browser window. <<<", flush=True)
        print(">>> Waiting up to 10 minutes... <<<\n", flush=True)

        logged_in = False
        for i in range(200):
            try:
                page.wait_for_timeout(3000)
            except Exception:
                print("Browser closed during login wait.", flush=True)
                return
            try:
                url = page.url
                if i % 10 == 0:
                    print(f"  (still waiting... url={url[:60]})", flush=True)
                if "signin" in url or "login" in url or "error" in url:
                    continue
                body = page.inner_text("body")
                if any(kw in body for kw in ["Sign Out", "My Purchases", "RYAN", "My Account"]):
                    logged_in = True
                    break
            except Exception:
                pass

        if not logged_in:
            print("Timed out waiting for login.", flush=True)
            try:
                browser.close()
            except Exception:
                pass
            return

        print("Logged in!\n", flush=True)

        # Load cached order URLs or collect fresh
        all_orders = []
        if URLS_FILE.exists():
            try:
                all_orders = json.loads(URLS_FILE.read_text())
                print(f"Loaded {len(all_orders)} cached order URLs.\n", flush=True)
            except Exception:
                all_orders = []

        if not all_orders:
            # Browse to purchase history like a human would
            human_wait(page, 3, 6)
            print("Navigating to purchase history...", flush=True)
            page.goto("https://www.kroger.com/mypurchases", wait_until="domcontentloaded")
            human_wait(page, 4, 8)
            human_scroll(page)

            for pg in range(1, 100):
                if pg > 1:
                    # Human-like pause before navigating to next page
                    human_wait(page, 4, 9)
                    human_scroll(page)
                    human_wait(page, 2, 4)
                    page.goto(
                        f"https://www.kroger.com/mypurchases?tab=purchases&page={pg}",
                        wait_until="domcontentloaded",
                    )
                try:
                    page.wait_for_selector(
                        'a[href*="/mypurchases/detail/"]', timeout=20_000
                    )
                except Exception:
                    human_wait(page, 3, 6)
                human_wait(page, 3, 7)
                human_scroll(page)
                human_wait(page, 2, 4)

                orders = extract_order_urls(page)
                if not orders:
                    break
                all_orders.extend(orders)
                print(
                    f"  Page {pg}: {len(orders)} orders (total: {len(all_orders)})",
                    flush=True,
                )
                human_wait(page, 2, 4)

            # Only cache if we got a reasonable number (avoid saving partial lists)
            if len(all_orders) >= 200:
                URLS_FILE.write_text(json.dumps(all_orders, indent=2))
                print(f"Saved {len(all_orders)} order URLs to {URLS_FILE}\n", flush=True)
            else:
                print(f"Only found {len(all_orders)} orders (expected 200+), not caching URLs.\n", flush=True)

        # Load existing data and figure out what's left
        results, done_urls = load_existing()
        remaining = [o for o in all_orders if o["url"] not in done_urls and o["type"] != "Fuel Center"]

        print(f"\nFound {len(all_orders)} total orders.", flush=True)
        print(f"Already scraped: {len(done_urls)}", flush=True)
        print(f"Remaining: {len(remaining)}", flush=True)
        print(f"Will scrape up to {batch_size} this run.\n", flush=True)

        if not remaining:
            print("Nothing to scrape!", flush=True)
            browser.close()
            return

        # Scrape one batch using detail pages (structured DOM extraction)
        scraped_this_run = 0
        for order in remaining:
            if scraped_this_run >= batch_size:
                break

            try:
                human_wait(page, 10, 20)
                page.goto(order["url"], wait_until="domcontentloaded")

                # Wait for item elements to render
                try:
                    page.wait_for_selector(
                        '[data-testid="cart-page-item-description"]',
                        timeout=30_000,
                    )
                except Exception:
                    human_wait(page, 5, 8)

                # Scroll to load all items (lazy-loaded)
                human_scroll(page)
                human_wait(page, 2, 4)
                human_scroll(page)
                human_wait(page, 1, 3)

                # Extract items via JS DOM query
                items = page.evaluate(EXTRACT_ITEMS_JS)

                result = {
                    "url": order["url"],
                    "type": order["type"],
                    "date": order["date"],
                    "total": order["total"],
                    "items": items,
                }
                results.append(result)
                print(
                    f"  {order['date']} {order['type']}: "
                    f"{len(items)} items, ${order['total']}",
                    flush=True,
                )

                scraped_this_run += 1

                # Save after each order
                OUTPUT_FILE.write_text(json.dumps(results, indent=2))

            except Exception as e:
                if "closed" in str(e).lower():
                    print("Browser closed. Saving progress...", flush=True)
                    break
                print(
                    f"  {order['date']} {order['type']}: error ({e})",
                    flush=True,
                )
                scraped_this_run += 1

        # Final save
        OUTPUT_FILE.write_text(json.dumps(results, indent=2))

        try:
            browser.close()
        except Exception:
            pass

    # Summary
    total_with_items = sum(1 for r in results if r.get("items"))
    total_items = sum(len(r.get("items", [])) for r in results)
    total_spent = sum(
        float(r.get("total", "0").replace(",", "")) for r in results
    )
    print(f"\nDone! Scraped {scraped_this_run} orders this run.", flush=True)
    print(f"Total orders saved: {len(results)}", flush=True)
    print(f"Orders with items: {total_with_items}", flush=True)
    print(f"Total items: {total_items}", flush=True)
    print(f"Total spent: ${total_spent:,.2f}", flush=True)


if __name__ == "__main__":
    import sys
    batch = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    main(batch_size=batch)
