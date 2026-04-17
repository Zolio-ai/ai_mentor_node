const express = require('express');
const router = express.Router();
const assessmentController = require('../controllers/assessmentController');
const { protect } = require('../middlewares/authMiddleware'); // Assuming this exists or similar

// Internal route for Voice Agent (Protected by secret key, not user session)
router.post('/internal/generate', assessmentController.generateInternalAssessment);
router.post('/internal/submit', assessmentController.submitInternalAssessment);

// Apply protect middleware to standard student routes
router.use(protect);

router.post('/generate', assessmentController.generateAssessment);
router.post('/submit', assessmentController.submitAssessment);

module.exports = router;
