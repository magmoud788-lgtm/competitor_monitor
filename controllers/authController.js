const bcrypt = require('bcryptjs');
const queries = require('../db/queries');

function showRegisterForm(req, res) {
  res.render('auth/register', { error: null });
}
const { sendAlertEmail } = require('../services/email');

async function register(req, res) {
  console.log("REGISTER STARTED");
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.render('auth/register', { error: 'name, email, and password are required' });
  }
  if (password.length < 8) {
    return res.render('auth/register', { error: 'Password must be at least 8 characters' });
  }


  const existing = await queries.findUserByEmail(email);
  if (existing.rows.length > 0) {
    return res.render('auth/register', { error: 'An account with that email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  console.log("REGISTER DB CHECK START");

const dbCheck = await queries.checkUsersTable();

console.log("REGISTER DB CHECK:", dbCheck.rows);

  const result = await queries.createUser(name, email, passwordHash);
  const newUser = result.rows[0];

  const rawToken = await queries.createVerificationToken(newUser.id);
  const verifyUrl = `${process.env.APP_URL}/auth/verify?token=${rawToken}`;

  await sendAlertEmail({
  to: newUser.email,
  subject: 'Verify your email',
  message: `Confirm your email to start receiving alerts: ${verifyUrl}`
});

  req.login(newUser, (err) => {
    if (err) {
        return res.render('auth/register', {
            error: 'Account created, but login failed'
        });
    }

    res.redirect('/competitors');
});
}

function showLoginForm(req, res) {
  const messages = req.session.messages || [];
  req.session.messages = [];
  res.render('auth/login', { error: messages[0] || null });
}

module.exports = { showRegisterForm, register, showLoginForm };