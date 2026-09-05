const queries = require('../db/queries');

async function showAccount(req, res) {
  const result = await queries.findUserById(req.userId);
  res.render('account/show', { user: result.rows[0], error: null });
}

async function updateProfile(req, res) {
  const { name, email } = req.body;
  if (!name || !email) {
    const current = await queries.findUserById(req.userId);
    return res.render('account/show', { user: current.rows[0], error: 'Name and email are required.' });
  }
  await queries.updateUser(req.userId, name, email);
  res.redirect('/account');
}

async function toggleNotifications(req, res) {
  const current = await queries.findUserById(req.userId);
  const newValue = !current.rows[0].notify_email;
  await queries.updateNotifyEmail(req.userId, newValue);
  res.redirect('/account');
}

function deleteAccount(req, res, next) {
  queries.deleteUser(req.userId).then(() => {
    req.logout((err) => {
      if (err) return next(err);
      res.redirect('/auth/login');
    });
  });
}

module.exports = { showAccount, updateProfile, toggleNotifications, deleteAccount };