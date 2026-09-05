const express = require('express');
const router = express.Router();
const passport = require('../passportConfig');
const auth = require('../controllers/authController');
const queries = require('../db/queries');

router.get('/register', auth.showRegisterForm);
router.post('/register', auth.register);

router.get('/login', auth.showLoginForm);
router.post(
  '/login',
  passport.authenticate('local', {
    successRedirect: '/competitors',
    failureRedirect: '/auth/login',
    failureMessage: true,
  })
);

router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/auth/login');
  });
});

router.get('/verify', async (req, res) => {
  const userId = await queries.consumeVerificationToken(req.query.token);
  if (!userId) {
    return res.render('auth/verify-result', { success: false });
  }
  res.render('auth/verify-result', { success: true });
});
module.exports = router;