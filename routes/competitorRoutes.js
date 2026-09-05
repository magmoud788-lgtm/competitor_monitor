const express = require('express');
const router = express.Router();
const competitors = require('../controllers/competitorController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', competitors.list);
router.post('/', competitors.create);
router.get('/:id/edit', competitors.showEditForm);
router.post('/:id/edit', competitors.update);
router.post('/:id/delete', competitors.remove);

module.exports = router;