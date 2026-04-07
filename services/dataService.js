const Student = require('../models/student');
const StudentData = require('../models/studentData');

exports.onboardStudent = async (studentId, academicData) => {
    const { stream, class: studentClass, marks10th, marks12th } = academicData;

    // Create or Update student data
    const data = await StudentData.findOneAndUpdate(
        { studentId },
        { stream, class: studentClass, marks10th, marks12th },
        { returnDocument: 'after', upsert: true }
    );
    
    return data;
};

exports.getFullProfile = async (studentId) => {
    // 1. Fetch student details but EXCLUDE the password
    const student = await Student.findById(studentId).select('-password');
    if (!student) throw new Error('Student account not found');
    
    // 2. Fetch the academic data for this student
    const academicData = await StudentData.findOne({ studentId });

    // 3. Return both combined
    return {
        ...student.toObject(),
        academic: academicData || null
    };
};