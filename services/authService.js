const Student = require('../models/student');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const registerStudent = async (studentData) => {
    const { firstName, lastName, email, phonenumber, password, userType } = studentData;
    const normalizedEmail = email.toLowerCase().trim();
    
    // 1. Check if student exists
    const existingStudent = await Student.findOne({ email: normalizedEmail });
    if (existingStudent) throw new Error('Student already exists');

    // 2. Hash Password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Create student
    const student = await Student.create({ 
        firstName, 
        lastName, 
        email: normalizedEmail, 
        phonenumber, 
        password: hashedPassword,
        userType: userType || 'student'
    });
    
    return student;
};

const loginStudent = async (email, password) => {
    const normalizedEmail = email.toLowerCase().trim();
    
    // 1. Find student
    const student = await Student.findOne({ email: normalizedEmail });
    if (!student) throw new Error('Invalid credentials');

    // 2. Validate Password
    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) throw new Error('Invalid credentials');

    // 3. Generate Token with the actual userType from DB
    const token = jwt.sign(
        { id: student._id, userType: student.userType }, 
        process.env.JWT_SECRET, 
        { expiresIn: '1d' }
    );
    return { student, token };
};

module.exports = {
    registerStudent,
    loginStudent
};
