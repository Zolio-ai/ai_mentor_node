const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');
const { protect } = require('../middlewares/authMiddleware');

// Protect all routes below
router.post('/store', protect, dataController.saveData);
router.get('/', protect, dataController.getData);

module.exports = router;
