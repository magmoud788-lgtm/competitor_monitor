const pool = require("../db/pool");
const { checkProduct } = require("./scrapper");

async function test() {
    try {
        const result = await pool.query(`
            SELECT
                tp.*,
                u.id AS user_id,
                u.email AS user_email
            FROM tracked_products tp
            JOIN competitors c
                ON c.id = tp.competitor_id
            JOIN users u
                ON u.id = c.user_id
            ORDER BY tp.id
            LIMIT 1
        `);

        if (result.rows.length === 0) {
            console.log("No tracked products found.");
            return;
        }

        const row = result.rows[0];

        const product = row;

        const user = {
            id: row.user_id,
            email: row.user_email
        };

        console.log("TEST PRODUCT:", product);
        console.log("TEST USER:", user);

        await checkProduct(product, user);

        console.log("CHECK FINISHED.");
    } catch (error) {
        console.error("TEST FAILED:", error);
    } finally {
        await pool.end();
    }
}

test();
