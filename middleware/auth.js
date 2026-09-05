function requireAuth(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.redirect('/auth/login');
    }

    req.userId = req.user.id;

    next();
}

module.exports = { requireAuth };