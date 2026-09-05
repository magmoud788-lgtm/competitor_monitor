const express = require('express');
const router = express.Router();
const products = require('../controllers/productController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', products.list);
router.post('/', products.create);
router.get('/:id/edit', products.showEditForm);
router.post('/:id/edit', products.update);
router.post('/:id/delete', products.remove);
router.get('/:id/history', products.showHistory);
router.post('/:id/check', products.checkProduct);
module.exports = router;