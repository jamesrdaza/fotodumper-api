require("dotenv").config();
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const passport = require("passport");
const pool = require("./db");
const app = express();

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    } else {
        res.redirect("/notAuthenticated");
    }
}

app.use(session({
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: false,
    store: new pgSession({
        pool: pool,
        tableName: "session"
    })
}));

app.use(passport.initialize());
app.use(passport.session());

const authRouter = require("./routes/auth");

app.use("/testLogin", ensureAuthenticated, (req, res) => {
    res.send("AUTHENTICATED");
});
app.use("/notAuthenticated", (req, res) => {
    res.send("NOT AUTHENTICATED");
})
app.use("/", authRouter);


app.listen(process.env.PORT || 3000, () => {
    console.log("Server listening...");
});