const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    type: {
        type: String,
        enum: ['TOPIC_PENDING', 'TEST_SCHEDULED'],
        required: true
    },
    topicName: {
        type: String,
        required: true
    },
    scheduledDate: {
        type: Date
    },
    isResolved: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('Reminder', reminderSchema);
