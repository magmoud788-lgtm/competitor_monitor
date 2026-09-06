const pool = require('./pool');

// --- users ---
const createUser = (name, email, passwordHash) =>
  pool.query(
    `INSERT INTO public.users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, name, email, created_at`,
    [name, email, passwordHash]
  );

const findUserByEmail = (email) =>
  pool.query(`SELECT * FROM users WHERE email = $1`, [email]);

const findUserById = (id) =>
  pool.query(`SELECT id, name, email, notify_email, email_verified, created_at FROM users WHERE id = $1`, [id]);
const updateUser = (id, name, email) =>
  pool.query(
    `UPDATE users SET name = $2, email = $3 WHERE id = $1
     RETURNING id, name, email, notify_email, created_at`,
    [id, name, email]
  );

const updateNotifyEmail = (id, notifyEmail) =>
  pool.query(
    `UPDATE users SET notify_email = $2 WHERE id = $1
     RETURNING id, name, email, notify_email`,
    [id, notifyEmail]
  );

const deleteUser = (id) =>
  pool.query(`DELETE FROM users WHERE id = $1`, [id]);

// --- competitors ---
const createCompetitor = (userId, name, websiteUrl) =>
  pool.query(
    `INSERT INTO competitors (user_id, name, website_url) VALUES ($1, $2, $3) RETURNING *`,
    [userId, name, websiteUrl]
  );

const listCompetitors = (userId) =>
  pool.query(`SELECT * FROM competitors WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);

const getCompetitorOwned = (competitorId, userId) =>
  pool.query(`SELECT * FROM competitors WHERE id = $1 AND user_id = $2`, [competitorId, userId]);

const updateCompetitor = (competitorId, userId, name, websiteUrl) =>
  pool.query(
    `UPDATE competitors SET name = $3, website_url = $4
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [competitorId, userId, name, websiteUrl]
  );

const deleteCompetitor = (competitorId, userId) =>
  pool.query(`DELETE FROM competitors WHERE id = $1 AND user_id = $2`, [competitorId, userId]);

// --- tracked products ---
const createTrackedProduct = (competitorId, name, productUrl, nameSelector, priceSelector, stockSelector) =>
  pool.query(
    `INSERT INTO tracked_products (competitor_id, name, product_url, name_selector, price_selector, stock_selector)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [competitorId, name, productUrl, nameSelector, priceSelector, stockSelector]
  );


const listTrackedProductsForUser = (userId) =>
  pool.query(
    `SELECT tp.*, c.name AS competitor_name
     FROM tracked_products tp
     JOIN competitors c ON c.id = tp.competitor_id
     WHERE c.user_id = $1
     ORDER BY tp.created_at DESC`,
    [userId]
  );

const listAllTrackedProducts = () =>
    pool.query(`
        SELECT
            tp.*,
            u.id AS user_id,
            u.email AS user_email
        FROM tracked_products tp
        JOIN competitors c
            ON c.id = tp.competitor_id
        JOIN users u
            ON u.id = c.user_id
    `);
const getTrackedProductOwned = (trackedProductId, userId) =>
  pool.query(
    `SELECT tp.* FROM tracked_products tp
     JOIN competitors c ON c.id = tp.competitor_id
     WHERE tp.id = $1 AND c.user_id = $2`,
    [trackedProductId, userId]
  );

const updateTrackedProduct = (trackedProductId, userId, name, productUrl, nameSelector, priceSelector, stockSelector) =>
  pool.query(
    `UPDATE tracked_products tp SET name = $3, product_url = $4,
       name_selector = $5, price_selector = $6, stock_selector = $7
     FROM competitors c
     WHERE tp.id = $1 AND tp.competitor_id = c.id AND c.user_id = $2
     RETURNING tp.*`,
    [trackedProductId, userId, name, productUrl, nameSelector, priceSelector, stockSelector]
  );

const deleteTrackedProduct = (trackedProductId, userId) =>
  pool.query(
    `DELETE FROM tracked_products tp
     USING competitors c
     WHERE tp.id = $1 AND tp.competitor_id = c.id AND c.user_id = $2`,
    [trackedProductId, userId]
  );

// --- snapshots ---
const insertSnapshot = (trackedProductId, name, price, stockStatus) =>
  pool.query(
    `INSERT INTO product_snapshots (tracked_product_id, name,  price, stock_status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [trackedProductId, name, price, stockStatus]
  );

const getLatestSnapshot = (trackedProductId) =>
  pool.query(
    `SELECT * FROM product_snapshots
     WHERE tracked_product_id = $1
     ORDER BY checked_at DESC LIMIT 1`,
    [trackedProductId]
  );

const getSnapshotHistory = (trackedProductId, limit = 30) =>
  pool.query(
    `SELECT * FROM product_snapshots
     WHERE tracked_product_id = $1
     ORDER BY checked_at DESC LIMIT $2`,
    [trackedProductId, limit]
  );

// For the AI chat: pull a compact summary of a user's whole tracked data
const getUserDataSummary = (userId) =>
  pool.query(
    `SELECT c.name AS competitor_name, tp.name AS product_name,
            ps.price, ps.stock_status, ps.checked_at
     FROM tracked_products tp
     JOIN competitors c ON c.id = tp.competitor_id
     LEFT JOIN LATERAL (
       SELECT price, stock_status, checked_at
       FROM product_snapshots
       WHERE tracked_product_id = tp.id
       ORDER BY checked_at DESC LIMIT 2
     ) ps ON true
     WHERE c.user_id = $1
     ORDER BY tp.name, ps.checked_at DESC`,
    [userId]
  );

// --- alerts ---
const createAlert = (trackedProductId, alertType, message) =>
  pool.query(
    `INSERT INTO alerts (tracked_product_id, alert_type, message) VALUES ($1, $2, $3) RETURNING *`,
    [trackedProductId, alertType, message]
  );

const markAlertEmailed = (alertId) =>
  pool.query(`UPDATE alerts SET emailed = TRUE WHERE id = $1`, [alertId]);

const hasRecentAlert = (trackedProductId, alertType, hours = 24) =>
  pool.query(
    `SELECT 1 FROM alerts
     WHERE tracked_product_id = $1 AND alert_type = $2
       AND created_at > NOW() - ($3 || ' hours')::interval
     LIMIT 1`,
    [trackedProductId, alertType, hours]
  );

const listRecentAlertsForUser = (userId, limit = 20) =>
  pool.query(
    `SELECT a.*, tp.name AS product_name, c.name AS competitor_name
     FROM alerts a
     JOIN tracked_products tp ON tp.id = a.tracked_product_id
     JOIN competitors c ON c.id = tp.competitor_id
     WHERE c.user_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  const setLowConfidence = (trackedProductId, isLowConfidence) =>
  pool.query(
    `UPDATE tracked_products SET is_low_confidence = $2 WHERE id = $1 RETURNING *`,
    [trackedProductId, isLowConfidence]
  );

 const getLatestKnownStockSnapshot = (trackedProductId) =>
    pool.query(
        `SELECT * FROM product_snapshots
         WHERE tracked_product_id = $1 AND stock_status != 'unknown'
         ORDER BY checked_at DESC
         LIMIT 1`,
        [trackedProductId]
    );

    const crypto = require('crypto');

const createVerificationToken = async (userId) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  await pool.query(
    `INSERT INTO verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return rawToken; // the only time the raw token exists — email it now, never store it
};

const consumeVerificationToken = async (rawToken) => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const result = await pool.query(
    `SELECT * FROM verification_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) return null;

  await pool.query(`UPDATE verification_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
  await pool.query(`UPDATE users SET email_verified = TRUE WHERE id = $1`, [row.user_id]);

  return row.user_id;
};

const createWaitlistSignup = (email, storeUrl, featureInterest) =>
  pool.query(
    `INSERT INTO waitlist_signups (email, store_url, feature_interest)
     VALUES ($1, $2, $3) RETURNING *`,
    [email, storeUrl || null, featureInterest || null]
  );

const listWaitlistSignups = () =>
  pool.query(`SELECT * FROM waitlist_signups ORDER BY created_at DESC`);
module.exports = {
  createUser, findUserByEmail, findUserById, updateUser, updateNotifyEmail, deleteUser,
  createCompetitor, listCompetitors, getCompetitorOwned, updateCompetitor, deleteCompetitor,
  createTrackedProduct, listTrackedProductsForUser, listAllTrackedProducts,
  getTrackedProductOwned, updateTrackedProduct, deleteTrackedProduct,
  insertSnapshot, getLatestSnapshot, getSnapshotHistory,
  getUserDataSummary,
  createAlert, markAlertEmailed, hasRecentAlert, listRecentAlertsForUser,
  setLowConfidence,
  getLatestKnownStockSnapshot,
  createVerificationToken,
  consumeVerificationToken,
  createWaitlistSignup,
  listWaitlistSignups
};