const queries = require('../db/queries');
const { scrapeProduct, validateProductPage, evaluateAndNotify} = require('../services/scrapper');

async function list(req, res) {
  const [productsResult, competitorsResult] = await Promise.all([
    queries.listTrackedProductsForUser(req.userId),
    queries.listCompetitors(req.userId),
  ]);
  res.render('products/list', {
    products: productsResult.rows,
    competitors: competitorsResult.rows,
    error: null,
  });
}

async function create(req, res) {
  const { competitor_id, name, product_url, name_selector, price_selector, stock_selector } = req.body;
  if (!competitor_id || !name || !product_url) {
    return rerenderListWithError(req, res, 'Competitor, name, and product URL are required.');
  }

  const owned = await queries.getCompetitorOwned(competitor_id, req.userId);
  if (owned.rows.length === 0) {
    return rerenderListWithError(req, res, 'That competitor was not found.');
  }

  let validation;
  try {
    validation = await validateProductPage(product_url, price_selector);
  } catch (err) {
    console.error('Validation error:', err);
    return rerenderListWithError(req, res, 'Could not load that URL to verify it — check the link and try again.');
  }

  if (!validation.ok) {
    return rerenderListWithError(req, res, validation.reason);
  }

  try {
    const inserted = await queries.createTrackedProduct(
      competitor_id, name, product_url, name_selector, price_selector, stock_selector
    );
    if (validation.lowConfidence) {
      await queries.setLowConfidence(inserted.rows[0].id, true);
    }
    res.redirect('/products');
  } catch (err) {
    if (err.code === '23505') {
      return rerenderListWithError(req, res, 'This product URL is already tracked for that competitor.');
    }
    throw err;
  }
}



  

async function rerenderListWithError(req, res, error) {
  const [productsResult, competitorsResult] = await Promise.all([
    queries.listTrackedProductsForUser(req.userId),
    queries.listCompetitors(req.userId),
  ]);
  res.render('products/list', { products: productsResult.rows, competitors: competitorsResult.rows, error });
}

async function showEditForm(req, res) {
  const owned = await queries.getTrackedProductOwned(req.params.id, req.userId);
  if (owned.rows.length === 0) return res.redirect('/products');
  res.render('products/edit', { product: owned.rows[0], error: null });
}

async function update(req, res) {
  const { name, product_url, name_selector, price_selector, stock_selector  } = req.body;
  if (!name || !product_url) {
    const owned = await queries.getTrackedProductOwned(req.params.id, req.userId);
    if (owned.rows.length === 0) return res.redirect('/products');
    return res.render('products/edit', {
      product: owned.rows[0],
      error: 'Name and product URL are required.',
    });
  }
  await queries.updateTrackedProduct(req.params.id, req.userId, name, product_url, name_selector, price_selector, stock_selector );
  res.redirect('/products');
}

async function remove(req, res) {
  await queries.deleteTrackedProduct(req.params.id, req.userId);
  res.redirect('/products');
}

async function showHistory(req, res) {

    const owned = await queries.getTrackedProductOwned(
        req.params.id,
        req.userId
    );

    if (owned.rows.length === 0) {
        return res.redirect('/products');
    }

    console.log("PRODUCT FROM DATABASE:", owned.rows[0]);
    console.log("LOW CONFIDENCE:", owned.rows[0].is_low_confidence);

    const history = await queries.getSnapshotHistory(req.params.id, 30);

    console.log("HISTORY:", history.rows);
    
    res.render('products/history', {
        product: owned.rows[0],
        history: history.rows
    });
}

const { sendPriceAlert, sendStockAlert } = require("../services/alertEmail");

async function checkProduct(req, res, next) {
    try {
        const result = await queries.getTrackedProductOwned(
            req.params.id,
            req.userId
        );

        if (result.rows.length === 0) {
            return res.redirect("/products");
        }

        const product = result.rows[0];

        console.log("Checking:", product.product_url);

        const scraped = await scrapeProduct(product);

        console.log("Scraped:", scraped);

        const userResult = await queries.findUserById(req.userId);
        const user = userResult.rows[0];

        await evaluateAndNotify(product, user, scraped);

        await queries.insertSnapshot(
            product.id,
            scraped.name,
            scraped.price,
            scraped.stockStatus
        );

        console.log("Snapshot saved.");

        res.redirect(`/products/${product.id}/history`);

    } catch (err) {
        console.error("Check product error:", err);
        next(err);
    }
}
module.exports = { list, create, showEditForm, update, remove, showHistory, checkProduct };