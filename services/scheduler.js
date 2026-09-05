const cron = require('node-cron');
const queries = require('../db/queries');
const { scrapeProduct, evaluateAndNotify } = require('./scrapper');
const {
    sendPriceAlert,
    sendStockAlert
} = require("./alertEmail");


async function checkAllProducts() {
    const { rows: products } =
        await queries.listAllTrackedProducts();

    console.log(
        `Scheduled check: ${products.length} product(s) to scan.`
    );

    for (const product of products) {
        try {
            const user = {
                id: product.user_id,
                email: product.user_email
            };

            const { rows: prevRows } =
                await queries.getLatestSnapshot(product.id);

            const previous = prevRows[0] || null;

            const scraped = await scrapeProduct(product);
            await evaluateAndNotify(product, user, scraped);
            
            await queries.insertSnapshot(
                product.id,
                scraped.name,
                scraped.price,
                scraped.stockStatus
            )

         } catch (err) {
            console.error(
                `Failed to check product ${product.id} (${product.product_url}):`,
                err.message
            );
        }
    }

    console.log("Scheduled check complete.");
}

function startScheduler() {
    // Every 6 hours — adjust the cron expression if you want a different cadence
    cron.schedule('0 */6 * * *', () => {
        checkAllProducts().catch(err => {
            console.error('Scheduled check run failed:', err);
        });
    });

    console.log('Scheduler started: checking all tracked products every 6 hours.');
}

module.exports = { startScheduler, checkAllProducts };