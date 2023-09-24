require("dotenv").config();
const express = require("express");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oidc");
const db = require("../db");

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: '/oauth2/redirect/google',
    scope: ['profile']
}, async function verify(issuer, profile, cb) {
    console.log("Verify Starting...");
    const userQuery = await db.query("SELECT * FROM federated_credentials WHERE provider = $1 AND subject = $2", [
        issuer,
        profile.id
    ]);

    if (userQuery.rows.length === 0) {
        db.query("INSERT INTO users (name) VALUES ($1) RETURNING id", [
            profile.displayName
        ], async (err, result) => {
            if (err) { return cb(err) }
            console.log(result);
            await db.query("INSERT INTO federated_credentials (user_id, provider, subject) VALUES ($1, $2, $3)", [
                result.rows[0].id,
                issuer,
                profile.id
            ]);

            return cb(null, { id: result.rows[0].id, name: profile.displayname });
        });

    } else {
        db.query("SELECT * FROM users WHERE id = $1", [
            userQuery.rows[0].user_id
        ], (err, result) => {
            if (err) { return cb(err); }
            return cb(null, userQuery.rows[0]);
        });
    }
}));

passport.serializeUser(function (user, cb) {
    process.nextTick(function () {
        cb(null, user);
    });
});

passport.deserializeUser(function (user, cb) {
    process.nextTick(function () {
        return cb(null, user);
    });
});

const router = express.Router();

router.get("/login/federated/google", passport.authenticate("google"));

router.get('/oauth2/redirect/google', passport.authenticate('google', {
    successRedirect: 'http://localhost:3000/testLogin/',
    failureRedirect: '/login'
}));

module.exports = router;