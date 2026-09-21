const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;

function configurePassport() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackURL = process.env.GOOGLE_CALLBACK_URL;

  if (clientID && clientSecret && callbackURL) {
    passport.use(
      'google',
      new GoogleStrategy(
        {
          clientID,
          clientSecret,
          callbackURL,
          passReqToCallback: true,
        },
        (req, accessToken, refreshToken, profile, done) => {
          const email =
            profile.emails && profile.emails[0] && profile.emails[0].value
              ? profile.emails[0].value
              : null;
          profile.email = email;
          profile.displayName = profile.displayName || email || 'Google user';
          return done(null, profile);
        }
      )
    );
  } else {
    console.warn(
      'WARNING: Google OAuth not fully configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL'
    );
  }

  passport.serializeUser((user, done) => {
    done(null, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    });
  });

  passport.deserializeUser((user, done) => {
    done(null, user);
  });

  return passport;
}

function isGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_CALLBACK_URL
  );
}

module.exports = { configurePassport, isGoogleConfigured };
