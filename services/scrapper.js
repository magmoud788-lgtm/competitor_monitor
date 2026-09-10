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


// ============================================================
// PRICE
// ============================================================

function parsePrice(rawPriceText) {
    if (rawPriceText === null || rawPriceText === undefined) {
        return null;
    }

    const cleaned = String(rawPriceText)
        .replace(/,/g, "")
        .replace(/[^\d.]/g, "");

    if (!cleaned) {
        return null;
    }

    const value = parseFloat(cleaned);

    return Number.isFinite(value) ? value : null;
}


// ============================================================
// AVAILABILITY NORMALIZATION
// ============================================================

function normalizeAvailability(raw) {
    if (raw === null || raw === undefined) {
        return "unknown";
    }

    const text = String(raw)
        .toLowerCase()
        .replace(/[\_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // Strong OUT signals
    if (
        text.includes("out of stock") ||
        text.includes("outofstock") ||
        text.includes("sold out") ||
        text.includes("soldout") ||
        text.includes("unavailable") ||
        text.includes("not available") ||
        text.includes("not in stock") ||
        text.includes("currently unavailable") ||
        text.includes("inventory 0") ||
        text.includes("stock 0")
    ) {
        return "out_of_stock";
    }

    // Strong IN signals
    if (
        text.includes("in stock") ||
        text.includes("instock") ||
        text.includes("currently available") ||
        text === "available"
    ) {
        return "in_stock";
    }

    return "unknown";
}


// ============================================================
// VARIANT AVAILABILITY
// ============================================================

function getVariantAvailability(variant) {
    if (!variant || typeof variant !== "object") {
        return "unknown";
    }

    // Explicit boolean availability
    if (typeof variant.available === "boolean") {
        return variant.available
            ? "in_stock"
            : "out_of_stock";
    }

    if (typeof variant.availableForSale === "boolean") {
        return variant.availableForSale
            ? "in_stock"
            : "out_of_stock";
    }

    if (typeof variant.available_for_sale === "boolean") {
        return variant.available_for_sale
            ? "in_stock"
            : "out_of_stock";
    }

    // Numeric inventory
    if (typeof variant.inventory_quantity === "number") {
        return variant.inventory_quantity > 0
            ? "in_stock"
            : "out_of_stock";
    }

    if (typeof variant.inventoryQuantity === "number") {
        return variant.inventoryQuantity > 0
            ? "in_stock"
            : "out_of_stock";
    }

    if (typeof variant.inventory === "number") {
        return variant.inventory > 0
            ? "in_stock"
            : "out_of_stock";
    }

    // String availability
    const availability =
        variant.availability ??
        variant.stockStatus ??
        variant.stock_status ??
        variant.inventoryStatus ??
        variant.inventory_status ??
        null;

    if (availability !== null) {
        return normalizeAvailability(availability);
    }

    return "unknown";
}


// ============================================================
// VARIANT ARRAY ANALYSIS
// ============================================================

function analyzeVariants(variants) {
    if (!Array.isArray(variants) || variants.length === 0) {
        return "unknown";
    }

    let hasInStock = false;
    let hasOutOfStock = false;
    let hasKnownStatus = false;

    for (const variant of variants) {
        const status = getVariantAvailability(variant);

        if (status === "in_stock") {
            hasInStock = true;
            hasKnownStatus = true;
        }

        if (status === "out_of_stock") {
            hasOutOfStock = true;
            hasKnownStatus = true;
        }
    }

    /*
     * If at least one purchasable variant exists,
     * the product is considered in stock.
     */
    if (hasInStock) {
        return "in_stock";
    }

    /*
     * Only report out_of_stock when we actually
     * know that every variant is unavailable.
     */
    if (
        hasOutOfStock &&
        !hasInStock &&
        hasKnownStatus
    ) {
        return "out_of_stock";
    }

    return "unknown";
}


// ============================================================
// EMBEDDED PRODUCT NORMALIZATION
// ============================================================

function normalizeEmbeddedProduct(data) {
    if (!data || typeof data !== "object") {
        return null;
    }

    const name =
        data.name ||
        data.productName ||
        data.product_name ||
        data.title ||
        null;

    const rawPrice =
        data.price ??
        data.productPrice ??
        data.product_price ??
        data.currentPrice ??
        data.current_price ??
        data.salePrice ??
        data.sale_price ??
        null;

    const price = parsePrice(rawPrice);

    let stockStatus = "unknown";

    // First check variants.
    const variants =
        data.variants ||
        data.Variants ||
        data.productVariants ||
        data.product_variants ||
        null;

    if (Array.isArray(variants)) {
        const variantStatus = analyzeVariants(variants);

        if (variantStatus !== "unknown") {
            stockStatus = variantStatus;
        }
    }

    // Then check direct product-level availability.
    if (stockStatus === "unknown") {
        const availability =
            data.availability ??
            data.stockStatus ??
            data.stock_status ??
            data.inventoryStatus ??
            data.inventory_status ??
            null;

        if (availability !== null) {
            stockStatus = normalizeAvailability(availability);
        }
    }

    // Explicit boolean availability.
    if (
        stockStatus === "unknown" &&
        typeof data.available === "boolean"
    ) {
        stockStatus = data.available
            ? "in_stock"
            : "out_of_stock";
    }

    if (
        stockStatus === "unknown" &&
        typeof data.availableForSale === "boolean"
    ) {
        stockStatus = data.availableForSale
            ? "in_stock"
            : "out_of_stock";
    }

    if (
        stockStatus === "unknown" &&
        typeof data.available_for_sale === "boolean"
    ) {
        stockStatus = data.available_for_sale
            ? "in_stock"
            : "out_of_stock";
    }

    // Numeric inventory.
    if (
        stockStatus === "unknown" &&
        typeof data.inventory_quantity === "number"
    ) {
        stockStatus =
            data.inventory_quantity > 0
                ? "in_stock"
                : "out_of_stock";
    }

    if (
        stockStatus === "unknown" &&
        typeof data.inventoryQuantity === "number"
    ) {
        stockStatus =
            data.inventoryQuantity > 0
                ? "in_stock"
                : "out_of_stock";
    }

    return {
        name,
        price,
        stockStatus
    };
}


// ============================================================
// JSON-LD
// ============================================================

function tryJsonLd($) {
    const scripts = $('script[type="application/ld+json"]');

    for (let i = 0; i < scripts.length; i++) {
        try {
            const raw = $(scripts[i]).html();

            if (!raw) {
                continue;
            }

            const data = JSON.parse(raw);

            let items = [];

            if (Array.isArray(data)) {
                items = data;
            } else if (Array.isArray(data["@graph"])) {
                items = data["@graph"];
            } else {
                items = [data];
            }

            for (const item of items) {
                if (!item) {
                    continue;
                }

                const type = item["@type"];

                const isProduct =
                    type === "Product" ||
                    (
                        Array.isArray(type) &&
                        type.includes("Product")
                    );

                if (!isProduct) {
                    continue;
                }

                const offers = Array.isArray(item.offers)
                    ? item.offers
                    : item.offers
                        ? [item.offers]
                        : [];

                let price = null;
                let stockStatus = "unknown";

                /*
                 * Look through offers instead of blindly
                 * taking offers[0].
                 */
                for (const offer of offers) {
                    if (!offer) {
                        continue;
                    }

                    if (price === null && offer.price != null) {
                        price = parsePrice(offer.price);
                    }

                    const availability =
                        normalizeAvailability(
                            offer.availability
                        );

                    if (
                        stockStatus === "unknown" &&
                        availability !== "unknown"
                    ) {
                        stockStatus = availability;
                    }
                }

                return {
                    name: item.name || null,
                    price,
                    stockStatus
                };
            }
        } catch {
            continue;
        }
    }

    return null;
}


// ============================================================
// META TAGS
// ============================================================

function tryMetaTags($) {
    const price =
        $('meta[property="product:price:amount"]')
            .attr("content") ||
        $('meta[property="og:price:amount"]')
            .attr("content");

    const name =
        $('meta[property="og:title"]')
            .attr("content") ||
        $('meta[name="twitter:title"]')
            .attr("content");

    const availability =
        $('meta[property="product:availability"]')
            .attr("content");

    if (!price && !name && !availability) {
        return null;
    }

    return {
        name: name || null,
        price: parsePrice(price),
        stockStatus: normalizeAvailability(
            availability
        )
    };
}


// ============================================================
// MICRODATA
// ============================================================

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


// ============================================================
// DOM PRICE DETECTION
// ============================================================

function scorePriceCandidate($, element) {
    const el = $(element);

    const text = el.text()
        .replace(/\s+/g, " ")
        .trim();

    if (!text || text.length > 100) {
        return null;
    }

    const dataPrice =
        el.attr("data-price") ||
        el.attr("data-product-price");

    const price = parsePrice(
        dataPrice || text
    );

    if (price === null) {
        return null;
    }

    const lower = text.toLowerCase();

    const attributes = [
        el.attr("class"),
        el.attr("id"),
        el.attr("data-price"),
        el.attr("data-product-price"),
        el.attr("itemprop"),
        el.attr("aria-label")
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    let score = 0;

    // Currency
    if (/[$€£¥₹]/.test(text)) {
        score += 20;
    }

    if (
        lower.includes("usd") ||
        lower.includes("eur") ||
        lower.includes("gbp") ||
        lower.includes("omr") ||
        lower.includes("aed")
    ) {
        score += 20;
    }

    // Strong product-price attributes
    if (
        /product-price|current-price|sale-price|price/
            .test(attributes)
    ) {
        score += 30;
    }

    if (el.attr("itemprop") === "price") {
        score += 50;
    }

    if (
        el.attr("data-price") ||
        el.attr("data-product-price")
    ) {
        score += 45;
    }

    // Things that commonly aren't the actual product price.
    if (
        /shipping|delivery|tax|compare|was|save|discount/
            .test(lower)
    ) {
        score -= 30;
    }

    if (text.length > 40) {
        score -= 20;
    }

    return {
        price,
        text,
        score
    };
}


function findProductFromDOM($) {
    const candidates = [];

    const selectors = [
        "[data-price]",
        "[data-product-price]",
        "[class*='price']",
        "[class*='Price']",
        "[itemprop='price']"
    ];

    $(selectors.join(",")).each((i, element) => {
        const candidate =
            scorePriceCandidate($, element);

        if (candidate) {
            candidates.push(candidate);
        }
    });

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort(
        (a, b) => b.score - a.score
    );

    /*
     * Do not blindly trust weak DOM candidates.
     */
    if (candidates[0].score < 30) {
        return null;
    }

    return {
        name: null,
        price: candidates[0].price,
        stockStatus: "unknown"
    };
}


// ============================================================
// GENERIC DOM AVAILABILITY
// LAST RESORT ONLY
// ============================================================

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

        if (!text || text.length > 200) {
            return;
        }

        const normalized =
            normalizeAvailability(text);

        if (normalized === "unknown") {
            return;
        }

        const style =
            el.attr("style") || "";

        if (
            /display\s*:\s*none/i
                .test(style)
        ) {
            return;
        }

        let score = 0;

        const lower = text.toLowerCase();

        if (
            lower.includes("in stock") ||
            lower.includes("out of stock") ||
            lower.includes("instock") ||
            lower.includes("outofstock")
        ) {
            score += 100;
        }

        if (
            lower.includes("sold out") ||
            lower.includes("soldout") ||
            lower.includes("unavailable")
        ) {
            score += 80;
        }

        if (
            el.attr("data-stock") ||
            el.attr("data-availability")
        ) {
            score += 60;
        }

        if (
            lower.includes("stock") ||
            lower.includes("availability") ||
            lower.includes("inventory")
        ) {
            score += 30;
        }

        if (
            el.attr("aria-label") ||
            el.attr("title")
        ) {
            score += 20;
        }

        candidates.push({
            status: normalized,
            score,
            text
        });
    });

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort(
        (a, b) => b.score - a.score
    );

    return candidates[0].status;
}


// ============================================================
// EMBEDDED APPLICATION DATA
// ============================================================

function findEmbeddedProductData($) {
    const scripts = $("script");

    for (let i = 0; i < scripts.length; i++) {
        const raw = $(scripts[i]).html();

        if (!raw) {
            continue;
        }

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

            const result =
                searchProductData(data);

            if (result) {
                return result;
            }
        } catch {
            continue;
        }
    }

    return null;
}


function searchProductData(data, depth = 0) {
    if (
        depth > 8 ||
        data === null ||
        data === undefined
    ) {
        return null;
    }

    if (Array.isArray(data)) {
        for (const item of data) {
            const result =
                searchProductData(
                    item,
                    depth + 1
                );

            if (result) {
                return result;
            }
        }

        return null;
    }

    if (typeof data !== "object") {
        return null;
    }

    const keys = Object.keys(data)
        .map(key => key.toLowerCase());

    const hasProductContext =
        keys.includes("product") ||
        keys.includes("productid") ||
        keys.includes("product_id") ||
        keys.includes("productname") ||
        keys.includes("product_name") ||
        keys.includes("variants") ||
        keys.includes("productdata") ||
        keys.includes("product_data") ||
        keys.includes("merchandise");

    const hasPrice =
        keys.includes("price") ||
        keys.includes("productprice") ||
        keys.includes("product_price") ||
        keys.includes("currentprice") ||
        keys.includes("current_price") ||
        keys.includes("saleprice") ||
        keys.includes("sale_price");

    const hasAvailability =
        keys.includes("available") ||
        keys.includes("availableforsale") ||
        keys.includes("available_for_sale") ||
        keys.includes("availability") ||
        keys.includes("stock") ||
        keys.includes("stockstatus") ||
        keys.includes("stock_status") ||
        keys.includes("inventoryquantity") ||
        keys.includes("inventory_quantity");

    /*
     * Product object.
     */
    if (
        hasProductContext &&
        (hasPrice || hasAvailability)
    ) {
        return normalizeEmbeddedProduct(data);
    }

    /*
     * Variant object.
     */
    const looksLikeVariant =
        keys.includes("variantid") ||
        keys.includes("variant_id") ||
        keys.includes("variant");

    if (
        looksLikeVariant &&
        (hasPrice || hasAvailability)
    ) {
        return normalizeEmbeddedProduct(data);
    }

    /*
     * Search deeper.
     */
    for (const key of Object.keys(data)) {
        const result =
            searchProductData(
                data[key],
                depth + 1
            );

        if (result) {
            return result;
        }
    }

    return null;
}


// ============================================================
// AUTOMATIC DETECTION
// ============================================================

function tryAutoDetect($) {
    const sources = [
        {
            name: "jsonld",
            priority: 100,
            result: tryJsonLd($)
        },
        {
            name: "embedded",
            priority: 90,
            result: findEmbeddedProductData($)
        },
        {
            name: "meta",
            priority: 70,
            result: tryMetaTags($)
        },
        {
            name: "microdata",
            priority: 60,
            result: tryMicrodata($)
        },
        {
            name: "dom",
            priority: 30,
            result: findProductFromDOM($)
        }
    ].filter(
        source => source.result
    );

    if (sources.length === 0) {
        return null;
    }

    const combined = {
        name: null,
        price: null,
        stockStatus: "unknown"
    };

    const nameSource = sources
        .filter(
            source => source.result.name
        )
        .sort(
            (a, b) => b.priority - a.priority
        )[0];

    const priceSource = sources
        .filter(
            source =>
                source.result.price !== null
        )
        .sort(
            (a, b) => b.priority - a.priority
        )[0];

    const stockSource = sources
        .filter(
            source =>
                source.result.stockStatus !==
                "unknown"
        )
        .sort(
            (a, b) => b.priority - a.priority
        )[0];

    if (nameSource) {
        combined.name =
            nameSource.result.name;
    }

    if (priceSource) {
        combined.price =
            priceSource.result.price;
    }

    if (stockSource) {
        combined.stockStatus =
            stockSource.result.stockStatus;
    }

    console.log(
        "AUTO DETECT SOURCES:",
        sources.map(source => ({
            source: source.name,
            name: source.result.name,
            price: source.result.price,
            stockStatus:
                source.result.stockStatus
        }))
    );

    console.log(
        "AUTO DETECT RESULT:",
        combined
    );

    return combined;
}


// ============================================================
// BROWSER DOM STOCK DETECTION
// ============================================================

async function detectAvailability(page) {
    const evidence = await page.evaluate(() => {
        const selectors = [
            "button",
            "[role='button']",
            "input",
            "[aria-label]",
            "[title]",
            "[data-stock]",
            "[data-availability]",
            "[data-available]",
            "[data-in-stock]",
            "[data-out-of-stock]",
            "[class*='stock']",
            "[class*='Stock']",
            "[class*='availability']",
            "[class*='Availability']",
            "[class*='inventory']",
            "[class*='Inventory']"
        ];

        return [
            ...document.querySelectorAll(
                selectors.join(",")
            )
        ]
            .map(el => ({
                tag: el.tagName,

                text:
                    el.innerText?.trim() || "",

                ariaLabel:
                    el.getAttribute(
                        "aria-label"
                    ) || "",

                title:
                    el.getAttribute(
                        "title"
                    ) || "",

                dataStock:
                    el.getAttribute(
                        "data-stock"
                    ) || "",

                dataAvailability:
                    el.getAttribute(
                        "data-availability"
                    ) || "",

                dataAvailable:
                    el.getAttribute(
                        "data-available"
                    ) || "",

                dataInStock:
                    el.getAttribute(
                        "data-in-stock"
                    ) || "",

                dataOutOfStock:
                    el.getAttribute(
                        "data-out-of-stock"
                    ) || "",

                visible: !!(
                    el.offsetWidth ||
                    el.offsetHeight ||
                    el.getClientRects().length
                )
            }))
            .filter(el => el.visible);
    });

    console.log(
        "GENERIC STOCK EVIDENCE:"
    );

    console.dir(
        evidence,
        { depth: null }
    );

    const candidates = [];

    for (const el of evidence) {
        const rawValues = [
            el.text,
            el.ariaLabel,
            el.title,
            el.dataStock,
            el.dataAvailability,
            el.dataAvailable,
            el.dataInStock,
            el.dataOutOfStock
        ].filter(Boolean);

        const combined =
            rawValues.join(" ");

        const lower =
            combined.toLowerCase();

        const status =
            normalizeAvailability(combined);

        if (status === "unknown") {
            continue;
        }

        let score = 0;

        if (
            lower.includes("in stock") ||
            lower.includes("out of stock") ||
            lower.includes("instock") ||
            lower.includes("outofstock")
        ) {
            score += 100;
        }

        if (
            lower.includes("sold out") ||
            lower.includes("soldout") ||
            lower.includes("unavailable")
        ) {
            score += 80;
        }

        if (
            el.dataStock ||
            el.dataAvailability ||
            el.dataAvailable ||
            el.dataInStock ||
            el.dataOutOfStock
        ) {
            score += 60;
        }

        if (
            lower.includes("stock") ||
            lower.includes("availability") ||
            lower.includes("inventory")
        ) {
            score += 30;
        }

        if (
            el.ariaLabel ||
            el.title
        ) {
            score += 20;
        }

        candidates.push({
            status,
            score,
            tag: el.tag,
            text: el.text,
            ariaLabel: el.ariaLabel,
            title: el.title,
            dataStock: el.dataStock,
            dataAvailability:
                el.dataAvailability,
            dataAvailable:
                el.dataAvailable,
            dataInStock:
                el.dataInStock,
            dataOutOfStock:
                el.dataOutOfStock
        });
    }

    if (candidates.length === 0) {
        console.log(
            "NO EXPLICIT STOCK SIGNAL FOUND"
        );

        return "unknown";
    }

    candidates.sort(
        (a, b) => b.score - a.score
    );

    console.log(
        "STOCK CANDIDATES:"
    );

    console.dir(
        candidates,
        { depth: null }
    );

    console.log(
        "SELECTED STOCK:",
        candidates[0]
    );

    return candidates[0].status;
}


// ============================================================
// PRODUCT PAGE VALIDATION
// ============================================================

async function validateProductPage(
    url,
    priceSelector
) {
    const browser =
        await chromium.launch({
            headless: true
        });

    try {
        const page =
            await browser.newPage();

        await page.goto(url, {
            waitUntil: "commit",
            timeout: 30000
        });

        await Promise.race([
            page.waitForLoadState(
                "networkidle"
            ),
            page.waitForTimeout(4000)
        ]);

        const html =
            await page.content();

        const $ =
            cheerio.load(html);

        const auto =
            tryAutoDetect($);

        /*
         * We found meaningful product information.
         */
        if (
            auto &&
            auto.name &&
            auto.price !== null
        ) {
            return {
                ok: true,
                lowConfidence: false
            };
        }

        /*
         * Explicit selector supplied by user.
         */
        if (priceSelector) {
            const matchCount =
                $(priceSelector).length;

            if (matchCount === 0) {
                return {
                    ok: false,
                    reason:
                        `No elements on that page matched the price selector "${priceSelector}".`
                };
            }

            if (matchCount > 5) {
                return {
                    ok: false,
                    reason:
                        "This looks like a page with multiple products — please link to a single product's page."
                };
            }

            return {
                ok: true,
                lowConfidence: true
            };
        }

        /*
         * The URL loaded successfully, but we could not
         * confidently identify a product.
         */
        return {
            ok: true,
            lowConfidence: true
        };

    } finally {
        await browser.close();
    }
}


// ============================================================
// ALERT EVALUATION
// ============================================================

async function evaluateAndNotify(
    product,
    user,
    newData
) {
    // --------------------------------------------------
    // Normalize incoming scraper data
    // --------------------------------------------------

    const finalPrice = parsePrice(newData.price);

    const finalStockStatus =
        normalizeAvailability(newData.stockStatus);

    const finalName =
        newData.name || product.name || null;

    const finalData = {
        name: finalName,
        price: finalPrice,
        stockStatus: finalStockStatus
    };

    console.log("NORMALIZED DATA:", finalData);


    // --------------------------------------------------
    // Low-confidence products
    // Save snapshot, but do not send alerts
    // --------------------------------------------------

    if (product.is_low_confidence) {
        console.log(
            `Low-confidence product ${product.id} — snapshot saved, alerts skipped`
        );

        await insertSnapshot(
            product.id,
            finalData.name,
            finalData.price,
            finalData.stockStatus
        );

        return;
    }


    // --------------------------------------------------
    // Unverified email
    // Save snapshot, but suppress notifications
    // --------------------------------------------------

    if (!user.email_verified) {
        console.log(
            `Notification suppressed — ${user.email} not verified`
        );

        await insertSnapshot(
            product.id,
            finalData.name,
            finalData.price,
            finalData.stockStatus
        );

        return;
    }


    // --------------------------------------------------
    // Get previous known stock status
    // --------------------------------------------------

    const knownStockResult =
        await getLatestKnownStockSnapshot(
            product.id
        );

    const oldKnownStockSnapshot =
        knownStockResult.rows[0];


    // --------------------------------------------------
    // Get latest snapshot
    // --------------------------------------------------

    const latestResult =
        await getLatestSnapshot(
            product.id
        );

    const oldSnapshot =
        latestResult.rows[0];


    // --------------------------------------------------
    // Compare against previous snapshot
    // --------------------------------------------------

    if (oldSnapshot) {

        // ----------------------------------------------
        // Price change
        // ----------------------------------------------

        const priceChanged =
            oldSnapshot.price !== null &&
            finalData.price !== null &&
            Number(oldSnapshot.price) !==
                Number(finalData.price);


        // ----------------------------------------------
        // Stock change
        // ----------------------------------------------

        const stockChanged =
            oldKnownStockSnapshot &&
            finalData.stockStatus !== "unknown" &&
            oldKnownStockSnapshot.stock_status !==
                finalData.stockStatus;


        // ----------------------------------------------
        // Price alert
        // ----------------------------------------------

        if (priceChanged) {

            const recent =
                await hasRecentAlert(
                    product.id,
                    "price_change",
                    24
                );

            if (recent.rows.length === 0) {

                await createAlert(
                    product.id,
                    "price_change",
                    `Price changed from ${oldSnapshot.price} to ${finalData.price}`
                );

                await sendPriceAlert(
                    user,
                    product,
                    oldSnapshot.price,
                    finalData.price
                );
            }
        }


        // ----------------------------------------------
        // Stock alert
        // ----------------------------------------------

        if (stockChanged) {

            const recent =
                await hasRecentAlert(
                    product.id,
                    "stock_change",
                    24
                );

            if (recent.rows.length === 0) {

                await createAlert(
                    product.id,
                    "stock_change",
                    `Stock changed from ${oldKnownStockSnapshot.stock_status} to ${finalData.stockStatus}`
                );

                await sendStockAlert(
                    user,
                    product,
                    oldKnownStockSnapshot.stock_status,
                    finalData.stockStatus
                );
            }
        }
    }


    // --------------------------------------------------
    // Always save the normalized snapshot
    // --------------------------------------------------

    await insertSnapshot(
        product.id,
        finalData.name,
        finalData.price,
        finalData.stockStatus
    );
}


// ============================================================
// MAIN SCRAPER
// ============================================================

async function scrapeProduct(
    trackedProduct
) {
    const browser =
        await chromium.launch({
            headless: true
        });

    try {
        const page =
            await browser.newPage();

        await page.goto(
            trackedProduct.product_url,
            {
                waitUntil: "commit",
                timeout: 30000
            }
        );

        /*
         * Give client-side JavaScript time to render.
         */
        await page.waitForTimeout(2000);

        const html =
            await page.content();

        console.log(
            "HAS $:",
            html.includes("$")
        );

        console.log(
            "HAS 10:",
            html.includes("10")
        );

        console.log(
            "HAS 16:",
            html.includes("16")
        );

        const $ =
            cheerio.load(html);

        /*
         * ====================================================
         * 1. AUTOMATIC PRODUCT DETECTION
         * ====================================================
         */
        const auto =
            tryAutoDetect($);

        let result = {
            name:
                auto?.name || null,

            price:
                auto?.price ?? null,

            stockStatus:
                auto?.stockStatus ||
                "unknown"
        };


        /*
         * ====================================================
         * 2. MANUAL NAME SELECTOR FALLBACK
         * ====================================================
         */
        if (
            !result.name &&
            trackedProduct.name_selector
        ) {
            const name =
                $(trackedProduct.name_selector)
                    .first()
                    .text()
                    .trim();

            result.name =
                name || null;
        }


        /*
         * ====================================================
         * 3. MANUAL PRICE SELECTOR FALLBACK
         * ====================================================
         */
        if (
            result.price === null &&
            trackedProduct.price_selector
        ) {
            const priceText =
                $(trackedProduct.price_selector)
                    .first()
                    .text()
                    .trim();

            result.price =
                parsePrice(priceText);
        }


        /*
         * ====================================================
         * 4. MANUAL STOCK SELECTOR
         * ====================================================
         *
         * If the user explicitly supplied one,
         * trust it before generic DOM guessing.
         */
        if (
            result.stockStatus === "unknown" &&
            trackedProduct.stock_selector
        ) {
            const stockText =
                $(trackedProduct.stock_selector)
                    .first()
                    .text()
                    .trim();

            const manualStock =
                normalizeAvailability(
                    stockText
                );

            if (
                manualStock !== "unknown"
            ) {
                result.stockStatus =
                    manualStock;
            }
        }


        /*
         * ====================================================
         * 5. GENERIC DOM FALLBACK
         * ====================================================
         *
         * Only run this when everything else failed.
         */
        if (
            result.stockStatus === "unknown"
        ) {
            const browserStock =
                await detectAvailability(
                    page
                );

            console.log(
                "GENERIC DOM STOCK:",
                browserStock
            );

            if (
                browserStock !== "unknown"
            ) {
                result.stockStatus =
                    browserStock;
            }
        }


        /*
         * ====================================================
         * FINAL RESULT
         * ====================================================
         */
        console.log(
            "FINAL SCRAPED RESULT:",
            result
        );

        return result;

    } finally {
        await browser.close();
    }
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    scrapeProduct,
    validateProductPage,
    evaluateAndNotify
};