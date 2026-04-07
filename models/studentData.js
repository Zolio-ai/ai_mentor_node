const mongoose = require('mongoose');

const studentDataSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    stream: { type: String, required: true },
    class: { type: Number, required: true },
    cgpa: { type: Number},
    marks: { 
        physics: { type: Number},
        chemistry: { type: Number},
        biology: { type: Number},
        maths: { type: Number}
    },
    entrance: {
        examtype: {
            type: String,
            enum: ['JEE', 'KEAM', 'NEET']
        }
    }
}, { timestamps: true });

module.exports = mongoose.model('StudentData', studentDataSchema);
