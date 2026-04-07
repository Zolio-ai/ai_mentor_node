const mongoose = require('mongoose');

const studentDataSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    stream: { type: String, required: true },
    class: { type: Number, required: true },
    cgpa10th: { type: Number, required: true},
    marks10th: { 
        physics: { type: Number, required: true},
        chemistry: { type: Number, required: true},
        biology: { type: Number, required: true},
        maths: { type: Number, required: true}
    },
    cgpa12th: { type: Number, required: true},
    marks12th: { 
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
