const path = require("node:path");
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const app = express();
const { startScheduler } = require('./services/scheduler');
startScheduler();
require('dotenv').config();
// =========================
// Basic Express setup
// =========================

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(express.static(path.join(__dirname, "public")));

app.use(express.urlencoded({ extended: false }));


// =========================
// Sessions
// =========================

app.use(
    session({
        secret: process.env.SESSION_SECRET || "development-secret",
        resave: false,
        saveUninitialized: false,
    })
);


// =========================
// Passport
// =========================

app.use(passport.initialize());
app.use(passport.session());


// =========================
// Routes
// =========================

const authRouter = require("./routes/authRoutes");
const competitorRouter = require("./routes/competitorRoutes");
const productRouter = require("./routes/productRoutes");
const accountRouter = require("./routes/userRoutes");
const waitlistRouter = require('./routes/waitlistRoutes');

app.use("/account", accountRouter);
app.use("/auth", authRouter);
app.use("/competitors", competitorRouter);
app.use("/products", productRouter);
app.use('/waitlist', waitlistRouter)

// =========================
// Home
// =========================

app.get("/", (req, res) => {
    res.render("index", {
        isAuthenticated: req.isAuthenticated()
    });
});

app.use((err, req, res, next) => {
  console.error('🔥 REAL ERROR:', err);
  console.error(err.stack);

  res.status(500).send('there is an error in the app pls try again later');
});
// =========================


// =========================
// Start server
// =========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`App listening on port ${PORT}`);
});