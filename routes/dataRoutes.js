const express = require('express');
const router = express.Router();
const multer = require('multer');

// Setup multer to store the file temporarily in memory
const upload = multer({ storage: multer.memoryStorage() });

const { saveStudentData, getProfile, getMarks, parseStudyMaterial, parseStudyPlan, assignPlan, getWeekProgress, updateTopicInternal, getStudyPlans, getStudyMaterials, getStudentActivePlan } = require('../controllers/dataController');
const { getCurrentWeekProgress, createReminder, getActiveReminders, resolveReminder, assignStudyMaterialToStudent } = require('../services/dataService');
const { protect } = require('../middlewares/authMiddleware');

// Internal routes (for voice agent)
router.post('/internal/update-topic', updateTopicInternal);
router.get('/internal/current-week-progress', async (req, res) => {
    const studentId = req.headers['x-student-id'];
    const secret = req.headers['x-internal-secret'];
    
    if (secret !== process.env.INTERNAL_KEY) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    
    try {
        const progress = await getCurrentWeekProgress(studentId);
        res.status(200).json({ success: true, data: progress });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/internal/reminder', async (req, res) => {
    const { studentId, topicName, type, scheduledDate, secret } = req.body;
    if (secret !== process.env.INTERNAL_KEY) return res.status(403).json({ success: false });

    try {
        const reminder = await createReminder(studentId, topicName, type, scheduledDate);
        res.status(201).json({ success: true, data: reminder });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/internal/reminders', async (req, res) => {
    const studentId = req.headers['x-student-id'];
    const secret = req.headers['x-internal-secret'];
    if (secret !== process.env.INTERNAL_KEY) return res.status(403).json({ success: false });

    try {
        const reminders = await getActiveReminders(studentId);
        res.status(200).json({ success: true, data: reminders });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/internal/resolve-reminder', async (req, res) => {
    const { studentId, topicName, type, secret } = req.body;
    if (secret !== process.env.INTERNAL_KEY) return res.status(403).json({ success: false });

    try {
        const result = await resolveReminder(studentId, topicName, type);
        res.status(200).json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Dashboard / Onboarding routes
router.post('/onboarding', protect, saveStudentData);

// Full Profile (Identity + Academic)
router.get('/profile', protect, getProfile);

// Fetch only marks
router.get('/marks', protect, getMarks);

// Parse and save study material
router.post('/parse-study-material', protect, upload.single('pdfFile'), parseStudyMaterial);

// Parse and save study plan
router.post('/parse-study-plan', protect, upload.single('pdfFile'), parseStudyPlan);

// Study Plan Assignments and Progress
router.post('/assign-plan', protect, assignPlan);
router.get('/current-week-progress', protect, getWeekProgress);

// Assign study material to student's active study plan
router.post('/assign-material', protect, async (req, res) => {
    try {
        const { materialId } = req.body;
        const studentId = req.user.id;
        
        if (!materialId) {
            return res.status(400).json({ success: false, message: 'materialId is required' });
        }
        
        const result = await assignStudyMaterialToStudent(studentId, materialId);
        res.status(200).json({ 
            success: true, 
            message: 'Study material assigned successfully',
            data: result 
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Create a reminder manually from the frontend UI
router.post('/reminder', protect, async (req, res) => {
    try {
        const { topicName, type, scheduledDate } = req.body;
        const studentId = req.user.id; // From protect middleware

        if (!topicName) {
            return res.status(400).json({ success: false, message: 'topicName is required' });
        }

        const reminder = await createReminder(studentId, topicName, type || 'TEST_SCHEDULED', scheduledDate);
        res.status(201).json({ success: true, message: 'Reminder beautifully scheduled', data: reminder });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Fetch all available plans and materials
router.get('/study-plans', protect, getStudyPlans);
router.get('/study-materials', protect, getStudyMaterials);

// Fetch logged-in student's active plan
router.get('/student-plan', protect, getStudentActivePlan);

module.exports = router;
