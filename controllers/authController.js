const authService = require('../services/authService');
const { asyncHandler } = require('../middlewares/errorMiddleware');

// @desc    Register student
// @route   POST /api/auth/register
// @access  Public
exports.register = asyncHandler(async (req, res) => {
    const student = await authService.registerStudent(req.body);
    res.status(201).json({ 
        success: true, 
        message: 'Student registered successfully',
        data: student 
    });
});

// @desc    Login student
// @route   POST /api/auth/login
// @access  Public
exports.login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400);
        throw new Error('Email and password are required');
    }
    const result = await authService.loginStudent(email, password);
    res.status(200).json({ success: true, data: result });
});
