const User = require('../models/user');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

exports.registerUser = async (userData) => {
    const { firstName, lastName, email, phonenumber, stream, password } = userData;
    const studentClass = userData.class; 
    
    // 1. Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) throw new Error('User already exists');

    // 2. Hash Password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Create user
    const user = await User.create({ 
        firstName, 
        lastName, 
        email, 
        phonenumber, 
        stream, 
        class: studentClass,
        password: hashedPassword
    });
    
    return user;
};

exports.loginUser = async (email, password) => {
    // 1. Find user
    const user = await User.findOne({ email });
    if (!user) throw new Error('Invalid credentials');

    // 2. Validate Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        throw new Error('Invalid credentials');
    }

    // 3. Generate Token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    return { user, token };
};
