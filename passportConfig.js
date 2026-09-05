const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const queries = require('./db/queries');

passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const result = await queries.findUserByEmail(email);
      const user = result.rows[0];
      if (!user) {
        return done(null, false, { message: 'Incorrect email' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return done(null, false, { message: 'Incorrect password' });
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await queries.findUserById(id);
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;