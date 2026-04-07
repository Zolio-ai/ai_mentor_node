const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');
const { protect } = require('../middlewares/authMiddleware');

// Dashboard / Onboarding routes
router.post('/onboarding', protect, dataController.saveStudentData);

// Full Profile (Identity + Academic)
router.get('/profile', protect, dataController.getProfile);

// Fetch only marks
router.get('/marks', protect, dataController.getMarks);

module.exports = router;
