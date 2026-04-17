const mongoose = require('mongoose');

const studyMaterialSchema = new mongoose.Schema({
    subject: {
        type: String,
        required: true,
    },
    fileName: {
        type: String,
        required: true,
    },
    chapters: [{
        chapterNumber: Number,
        title: String,
        content: String // Everything inside the chapter
    }],
    rawContent: {
        type: String,
    },
    uploadedAt: {
        type: Date,
        default: Date.now,
    }
});

module.exports = mongoose.model('StudyMaterial', studyMaterialSchema);