const express = require('express');
const router = express.Router();
const user = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', user.showAccount);
router.post('/', user.updateProfile);
router.post('/notifications', user.toggleNotifications);
router.post('/delete', user.deleteAccount);

module.exports = router;