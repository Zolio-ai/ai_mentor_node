const mongoose = require('mongoose');

const assessmentResultSchema = new mongoose.Schema({
    assessmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Assessment',
        required: true
    },
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student', // Or User depending on your auth model
        required: true
    },
    responses: [{
        questionText: String,
        userAnswer: String,
        isCorrect: Boolean,
        feedback: String
    }],
    score: {
        type: Number,
        required: true
    },
    analysis: {
        strengths: [String],
        weaknesses: [String],
        overallFeedback: String
    },
    isInternal: {
        type: Boolean,
        default: false
    },
    completedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('AssessmentResult', assessmentResultSchema);
