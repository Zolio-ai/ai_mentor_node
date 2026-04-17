const express = require('express');
const router = express.Router();
const { register, login, registerStaff, getSandboxToken } = require('../controllers/authController');

// Standard student register (default type)
router.post('/register', register);
// General staff/admin register (manual type)
router.post('/register-staff', registerStaff);
router.post('/login', login);
// Sandbox token for testing
router.post('/sandbox/token', getSandboxToken);

module.exports = router;
