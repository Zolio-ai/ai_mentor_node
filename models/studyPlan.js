const mongoose = require('mongoose');

const studyPlanSchema = new mongoose.Schema({
    planName: {
        type: String,
        required: true,
    },
    weeks: [{
        weekNumber: Number,
        title: String,
        topics: [String]
    }],
    rawContent: {
        type: String,
    },
    uploadedAt: {
        type: Date,
        default: Date.now,
    }
});

module.exports = mongoose.model('StudyPlan', studyPlanSchema);