const { registerStudent, loginStudent } = require('../services/authService');
const { asyncHandler } = require('../middlewares/errorMiddleware');
const jwt = require('jsonwebtoken');
const Student = require('../models/student');

// @desc    Register student
// @route   POST /api/auth/register
// @access  Public
const register = asyncHandler(async (req, res) => {
    // Force student type for standard registration
    const student = await registerStudent({ ...req.body, userType: 'student' });
    res.status(201).json({ 
        success: true, 
        message: 'Student registered successfully',
        data: student 
    });
});

// @desc    Register Staff/General User (Manual userType)
// @route   POST /api/auth/register-staff
// @access  Public
const registerStaff = asyncHandler(async (req, res) => {
    const user = await registerStudent(req.body);
    res.status(201).json({ 
        success: true, 
        message: `${user.userType} registered successfully`,
        data: user 
    });
});

// @desc    Login student
// @route   POST /api/auth/login
// @access  Public
const login = asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400);
        throw new Error('Email and password are required');
    }
    const result = await loginStudent(email, password);
    res.status(200).json({ success: true, data: result });
});

// @desc    Get sandbox token for testing
// @route   POST /api/auth/sandbox/token
// @access  Public
const getSandboxToken = asyncHandler(async (req, res) => {
    const { email } = req.body;
    
    // Find or create a test student
    let student = await Student.findOne({ email });
    if (!student) {
        // Create a test student if not exists
        student = new Student({
            firstName: 'Test',
            lastName: 'User',
            email,
            password: 'test123',
            userType: 'student',
            stream: 'Science',
            class: '12',
            phonenumber: '1234567890'
        });
        await student.save();
    }
    
    // Generate token
    const token = jwt.sign(
        { id: student._id, userType: 'student' },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
    
    res.status(200).json({ 
        success: true, 
        token,
        data: {
            _id: student._id,
            firstName: student.firstName,
            lastName: student.lastName,
            email: student.email,
            userType: student.userType
        }
    });
});

module.exports = {
    register,
    registerStaff,
    login,
    getSandboxToken
};
