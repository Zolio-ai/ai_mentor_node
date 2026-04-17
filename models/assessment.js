const mongoose = require('mongoose');

const assessmentSchema = new mongoose.Schema({
    studyMaterialId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StudyMaterial',
        required: false
    },
    title: {
        type: String,
        required: true
    },
    questions: [{
        questionText: { type: String, required: true },
        options: [String], // Only for MCQ
        correctAnswer: { type: String, required: true },
        type: { type: String, enum: ['mcq', 'subjective'], default: 'mcq' }
    }],
    isInternal: {
        type: Boolean,
        default: false
    },
    weekNumber: {
        type: Number
    },
    topics: [String],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Assessment', assessmentSchema);
