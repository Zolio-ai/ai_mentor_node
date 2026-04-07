const dataService = require('../services/dataService');
const { asyncHandler } = require('../middlewares/errorMiddleware');

// @desc    Onboard student data (academic info)
// @route   POST /api/data/onboarding
// @access  Private
exports.saveStudentData = asyncHandler(async (req, res) => {
    const studentId = req.user.id; // From auth middleware
    const data = await dataService.onboardStudent(studentId, req.body);
    res.status(201).json({ success: true, data });
});

// @desc    Get full student profile (identity + academic info)
// @route   GET /api/data/profile
// @access  Private
exports.getProfile = asyncHandler(async (req, res) => {
    const studentId = req.user.id; // From auth middleware
    const profile = await dataService.getFullProfile(studentId);
    res.status(200).json({ success: true, data: profile });
});

// @desc Get only marks
// @route GET /api/data/marks
// @access Private
exports.getMarks = asyncHandler(async (req, res) => {
    const studentId = req.user.id;
    const marks = await dataService.getMarks(studentId);
    res.status(200).json({ success: true, data: marks });
});