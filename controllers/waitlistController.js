const queries = require('../db/queries');
require('dotenv').config();

async function join(req, res) {
  const { email, store_url, feature_interest } = req.body;

  if (!email) {
    return res.redirect('/?error=Email+is+required');
  }

  try {
    await queries.createWaitlistSignup(email, store_url, feature_interest);
    res.redirect('/?joined=1');
  } catch (err) {
    if (err.code === '23505') {
      return res.redirect('/?error=You+are+already+on+the+list');
    }
    throw err;
  }
}

// in a controller, or add to waitlistController.js
async function viewSignups(req, res) {
  console.log("req.userId:", req.userId, typeof req.userId);
  console.log("ADMIN_USER_ID:", process.env.ADMIN_USER_ID, typeof process.env.ADMIN_USER_ID);

  if (req.userId !== Number(process.env.ADMIN_USER_ID)) {
    return res.status(403).send('Not authorized');
  }

  const result = await queries.listWaitlistSignups();
  res.render('waitlist/list', { signups: result.rows });
}

module.exports = { join, viewSignups };