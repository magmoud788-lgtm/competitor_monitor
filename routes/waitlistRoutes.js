const express = require('express');
const router = express.Router();
const waitlistController = require('../controllers/waitlistController');
const { requireAuth } = require('../middleware/auth');

router.post('/', waitlistController.join);
router.get('/admin', requireAuth, waitlistController.viewSignups);

module.exports = router;