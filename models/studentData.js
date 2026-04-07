const mongoose = require('mongoose');

const studentDataSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    stream: { type: String, required: true },
    class: { type: Number, required: true },
    marks10th: { type: Number, required: true },
    marks12th: { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('StudentData', studentDataSchema);
