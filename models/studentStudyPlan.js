const mongoose = require('mongoose');

const studentStudyPlanSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    planId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StudyPlan',
        required: true
    },
    studyMaterialId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StudyMaterial',
        required: false
    },
    startDate: {
        type: Date,
        default: () => {
            const d = new Date();
            d.setHours(0,0,0,0);
            return d;
        }
    },
    completedTopics: [{
        topicName: { type: String, required: true },
        completedAt: { type: Date, default: Date.now }
    }],
    masteredTopics: [{
        topicName: { type: String, required: true },
        masteredAt: { type: Date, default: Date.now }
    }],
    weaknessTopics: [{
        topicName: { type: String, required: true },
        identifiedAt: { type: Date, default: Date.now }
    }],
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('StudentStudyPlan', studentStudyPlanSchema);
