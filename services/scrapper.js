const cheerio = require("cheerio");
const { chromium } = require("playwright");

const {
    getLatestSnapshot,
    insertSnapshot,
    getLatestKnownStockSnapshot,
    hasRecentAlert,
    createAlert
} = require("../db/queries");

const {
    sendPriceAlert,
    sendStockAlert
} = require("./alertEmail");




function parsePrice(rawPriceText) {
    if (!rawPriceText) return null;

    const cleaned = rawPriceText
        .replace(/,/g, "")
        .replace(/[^\d.]/g, "");

    const value = parseFloat(cleaned);

    return Number.isNaN(value) ? null : value;
}

function normalizeAvailability(raw) {
    if (!raw) return "unknown";

    const text = raw
        .toLowerCase()
        .replace(/[_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (
        text.includes("out of stock") ||
        text.includes("outofstock") ||
        text.includes("sold out") ||
        text.includes("unavailable")
    ) {
        return "out_of_stock";
    }

    if (
        text.includes("in stock") ||
        text.includes("instock")
    ) {
        return "in_stock";
    }

    return "unknown";
}

/* ---------------- JSON-LD ---------------- */

function tryJsonLd($) {
    const scripts = $('script[type="application/ld+json"]');

    for (let i = 0; i < scripts.length; i++) {
        try {
            const raw = $(scripts[i]).html();
            const data = JSON.parse(raw);

            const items = Array.isArray(data)
                ? data
                : data["@graph"]
                    ? data["@graph"]
                    : [data];

            for (const item of items) {
                if (!item) continue;

                const type = item["@type"];

                const isProduct =
                    type === "Product" ||
                    (Array.isArray(type) && type.includes("Product"));

                if (!isProduct) continue;

                const offers = Array.isArray(item.offers)
                    ? item.offers[0]
                    : item.offers;

                return {
                    name: item.name || null,

                    price:
                        offers?.price != null
                            ? parsePrice(String(offers.price))
                            : null,

                    stockStatus: normalizeAvailability(
                        offers?.availability
                    )
                };
            }
        } catch {
            continue;
        }
    }

    return null;
}

/* ---------------- META ---------------- */

function tryMetaTags($) {
    const price =
        $('meta[property="product:price:amount"]').attr("content") ||
        $('meta[property="og:price:amount"]').attr("content");

    const name =
        $('meta[property="og:title"]').attr("content") ||
        $('meta[name="twitter:title"]').attr("content");

    const availability =
        $('meta[property="product:availability"]').attr("content");

    if (!price && !name && !availability) {
        return null;
    }

    return {
        name: name || null,
        price: parsePrice(price),
        stockStatus: normalizeAvailability(availability)
    };
}

/* ---------------- MICRODATA ---------------- */

function tryMicrodata($) {
    const priceEl = $('[itemprop="price"]').first();
    const nameEl = $('[itemprop="name"]').first();
    const stockEl = $('[itemprop="availability"]').first();

    const price =
        priceEl.attr("content") ||
        priceEl.text().trim();

    const name =
        nameEl.attr("content") ||
        nameEl.text().trim();

    const stock =
        stockEl.attr("href") ||
        stockEl.text().trim();

    if (!price && !name && !stock) {
        return null;
    }

    return {
        name: name || null,
        price: parsePrice(price),
        stockStatus: normalizeAvailability(stock)
    };
}

// ---------------- DOM PRODUCT DATA ----------------

function findProductFromDOM($) {
    const candidates = [];

    const selectors = [
        '[data-price]',
        '[data-product-price]',
        '[data-product]',
        '[data-product-id]',
        '[class*="price"]',
        '[class*="Price"]'
    ];

    $(selectors.join(",")).each((i, element) => {
        const el = $(element);

        const text = el.text().replace(/\s+/g, " ").trim();

        if (!text || text.length > 100) return;

        const dataPrice =
            el.attr("data-price") ||
            el.attr("data-product-price");

        const price = parsePrice(dataPrice || text);

        if (price === null) return;

        candidates.push({
            price,
            text,
            score: 0
        });
    });

    if (candidates.length === 0) {
        return null;
    }

    // Score candidates.
    for (const candidate of candidates) {
        const lower = candidate.text.toLowerCase();

        if (
            lower.includes("$") ||
            lower.includes("€") ||
            lower.includes("£") ||
            lower.includes("¥")
        ) {
            candidate.score += 20;
        }

        if (
            lower.includes("usd") ||
            lower.includes("eur") ||
            lower.includes("gbp") ||
            lower.includes("omr") ||
            lower.includes("aed")
        ) {
            candidate.score += 20;
        }

        if (candidate.text.length < 30) {
            candidate.score += 10;
        }
    }

    candidates.sort((a, b) => {
        return b.score - a.score;
    });

    return {
        name: null,
        price: candidates[0].price,
        stockStatus: "unknown"
    };
}


// ---------------- DOM AVAILABILITY ----------------

function findAvailabilityFromDOM($) {
    const candidates = [];

    const selectors = [
        "button",
        "[role='button']",
        "input[type='submit']",
        "input[type='button']",
        "[aria-label]",
        "[data-availability]",
        "[data-stock]",
        "[class*='stock']",
        "[class*='Stock']",
        "[class*='availability']",
        "[class*='Availability']"
    ];

    $(selectors.join(",")).each((i, element) => {
        const el = $(element);

        const text = [
            el.text(),
            el.attr("aria-label"),
            el.attr("data-availability"),
            el.attr("data-stock"),
            el.attr("title")
        ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        if (!text || text.length > 200) return;

        const normalized = normalizeAvailability(text);

        if (normalized === "unknown") return;

        const style = el.attr("style") || "";

        // Ignore elements explicitly hidden with inline display:none.
        if (/display\s*:\s*none/i.test(style)) {
            return;
        }

        let score = 0;

        if (
            text.toLowerCase().includes("in stock") ||
            text.toLowerCase().includes("out of stock")
        ) {
            score += 50;
        }

        if (
            text.toLowerCase().includes("sold out") ||
            text.toLowerCase().includes("available") ||
            text.toLowerCase().includes("unavailable")
        ) {
            score += 30;
        }

        if (
            el.is("button") ||
            el.attr("role") === "button"
        ) {
            score += 20;
        }

        candidates.push({
            status: normalized,
            text,
            score
        });
    });

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((a, b) => {
        return b.score - a.score;
    });

    return candidates[0].status;
}


// ---------------- EMBEDDED APPLICATION DATA ----------------

function findEmbeddedProductData($) {
    const scripts = $("script");

    for (let i = 0; i < scripts.length; i++) {
        const raw = $(scripts[i]).html();

        if (!raw) continue;

        const text = raw.trim();

        // Only inspect JSON-looking script blocks.
        if (
            !text.startsWith("{") &&
            !text.startsWith("[")
        ) {
            continue;
        }

        try {
            const data = JSON.parse(text);

            const result = searchProductData(data);

            if (result) {
                return result;
            }
        } catch {
            continue;
        }
    }

    return null;
}


function searchProductData(data) {
    if (!data || typeof data !== "object") {
        return null;
    }

    // Direct product-like object.
    const price =
        data.price ??
        data.productPrice ??
        data.currentPrice ??
        data.salePrice;

    const availability =
        data.availability ??
        data.stockStatus ??
        data.inventoryStatus;

    const name =
        data.name ??
        data.productName ??
        data.title;

    if (price != null || availability != null || name != null) {
        const parsedPrice =
            price != null
                ? parsePrice(String(price))
                : null;

        const stock =
            availability != null
                ? normalizeAvailability(String(availability))
                : "unknown";

        if (
            parsedPrice !== null ||
            stock !== "unknown" ||
            name
        ) {
            return {
                name: name || null,
                price: parsedPrice,
                stockStatus: stock
            };
        }
    }

    // Recursively search nested objects.
    for (const key of Object.keys(data)) {
        const value = data[key];

        if (!value || typeof value !== "object") {
            continue;
        }

        const result = searchProductData(value);

        if (result) {
            return result;
        }
    }

    return null;
}

/* ---------------- AUTOMATIC DETECTION ---------------- */

function tryAutoDetect($) {
    const results = [
        tryJsonLd($),
        tryMetaTags($),
        tryMicrodata($),
        findProductFromDOM($),
        findEmbeddedProductData($)
    ].filter(Boolean);

    const combined = {
        name: null,
        price: null,
        stockStatus: "unknown"
    };

    for (const result of results) {
        if (!combined.name && result.name) {
            combined.name = result.name;
        }

        if (
            combined.price === null &&
            result.price !== null
        ) {
            combined.price = result.price;
        }

        if (
            combined.stockStatus === "unknown" &&
            result.stockStatus !== "unknown"
        ) {
            combined.stockStatus = result.stockStatus;
        }
    }

    if (combined.stockStatus === "unknown") {
        const domStock = findAvailabilityFromDOM($);

        if (domStock) {
            combined.stockStatus = domStock;
        }
    }

    const foundSomething =
        combined.name ||
        combined.price !== null ||
        combined.stockStatus !== "unknown";

    return foundSomething ? combined : null;
}

/* ---------------- MAIN SCRAPER ---------------- */
async function detectAvailability(page) {
    try {
        await page.waitForSelector("button.btn-size", { timeout: 10000 });
    } catch {
        return "unknown"; // never rendered — don't guess out_of_stock
    }

    const buttons = await page.locator("button.btn-size").evaluateAll(buttons =>
        buttons
            .filter(button => /^\d+(\.\d+)?$/.test(button.innerText.trim()))
            .map(button => ({
                disabled: button.disabled,
                visible: !!(button.offsetWidth || button.offsetHeight || button.getClientRects().length)
            }))
    );

    if (buttons.length === 0) return "unknown";

    const availableSizes = buttons.filter(b => b.visible && !b.disabled);

    return availableSizes.length > 0 ? "in_stock" : "out_of_stock";
}

async function validateProductPage(url, priceSelector) {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: "commit", timeout: 30000 });
        await Promise.race([
            page.waitForLoadState("networkidle"),
            page.waitForTimeout(4000)
        ]);

        const html = await page.content();
        const $ = cheerio.load(html);

        if (tryJsonLd($)) {
            return { ok: true, lowConfidence: false };
        }

        const meta = tryMetaTags($);
        if (meta && meta.name && meta.price !== null) {
            return { ok: true, lowConfidence: false };
        }

        if (priceSelector) {
            const matchCount = $(priceSelector).length;

            if (matchCount === 0) {
                return {
                    ok: false,
                    reason: `No elements on that page matched the price selector "${priceSelector}".`
                };
            }

            if (matchCount > 5) {
                return {
                    ok: false,
                    reason: "This looks like a page with multiple products — please link to a single product's page."
                };
            }

            return { ok: true, lowConfidence: true };
        }

        return { ok: true, lowConfidence: true };
    } finally {
        await browser.close();
    }
}

async function evaluateAndNotify(product, user, newData) {
    const knownStockResult = await getLatestKnownStockSnapshot(product.id);
    const oldKnownStockSnapshot = knownStockResult.rows[0];

    const latestResult = await getLatestSnapshot(product.id);
    const oldSnapshot = latestResult.rows[0];

if (!user.email_verified) {
  console.log(`Notification suppressed — ${user.email} not verified`);
  return;
}

    if (!oldSnapshot) return;

    if (product.is_low_confidence) return; // gate everything, once, up top

    const priceChanged =
        oldSnapshot.price !== null &&
        newData.price !== null &&
        Number(oldSnapshot.price) !== Number(newData.price);

    const stockChanged =
        oldKnownStockSnapshot &&
        newData.stockStatus !== "unknown" &&
        oldKnownStockSnapshot.stock_status !== newData.stockStatus;

    if (priceChanged) {
    const recent = await hasRecentAlert(product.id, "price_change", 24);
    if (recent.rows.length === 0) {
        await createAlert(product.id, "price_change",
            `Price changed from ${oldSnapshot.price} to ${newData.price}`);
        await sendPriceAlert(user, product, oldSnapshot.price, newData.price);
    }
}

if (stockChanged) {
    const recent = await hasRecentAlert(product.id, "stock_change", 24);
    if (recent.rows.length === 0) {
        await createAlert(product.id, "stock_change",
            `Stock changed from ${oldKnownStockSnapshot.stock_status} to ${newData.stockStatus}`);
        await sendStockAlert(user, product, oldKnownStockSnapshot.stock_status, newData.stockStatus);
    }
}
}

async function scrapeProduct(trackedProduct) {
    const browser = await chromium.launch({
        headless: true
    });

    try {
        const page = await browser.newPage();

        await page.goto(trackedProduct.product_url, {
            waitUntil: "commit",
            timeout: 30000
        });

        // Give JavaScript time to finish rendering
        await page.waitForTimeout(2000);
        const stockStatus = await detectAvailability(page);

console.log("DETECTED STOCK:", stockStatus);
        
        const html = await page.content();
        console.log("HAS $:", html.includes("$"));
console.log("HAS 10:", html.includes("10"));
console.log("HAS 16:", html.includes("16"));

        const $ = cheerio.load(html);

        /*
         * First try automatic structured-data detection.
         */
        const auto = tryAutoDetect($);

       if (auto) {
    if (auto.stockStatus === "unknown") {
        auto.stockStatus = stockStatus;
    }

    console.log("SCRAPED:", auto);
    return auto;
}
        const result = auto || {
            name: null,
            price: null,
            stockStatus: "unknown"
        };

        /*
         * Manual selectors fill in anything
         * automatic detection could not find.
         */

        if (
            !result.name &&
            trackedProduct.name_selector
        ) {
            const name = $(
                trackedProduct.name_selector
            )
                .text()
                .trim();

            result.name = name || null;
        }

        if (
            result.price === null &&
            trackedProduct.price_selector
        ) {
            const priceText = $(
                trackedProduct.price_selector
            )
                .text()
                .trim();

            result.price = parsePrice(priceText);
        }

        if (
            result.stockStatus === "unknown" &&
            trackedProduct.stock_selector
        ) {
            const stockText = $(
                trackedProduct.stock_selector
            )
                .text()
                .trim();

            result.stockStatus =
                normalizeAvailability(stockText);
        }

        console.log("SCRAPED:", result);

        return result;

    } finally {
        await browser.close();
    }
}

module.exports = {
    scrapeProduct,
    validateProductPage,
    evaluateAndNotify
};
