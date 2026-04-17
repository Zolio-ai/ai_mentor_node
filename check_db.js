const mongoose = require('mongoose');
require('dotenv').config();
const Assessment = require('./models/assessment');
const AssessmentResult = require('./models/assessmentResult');

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');
        
        const assessments = await Assessment.find().sort({ createdAt: -1 }).limit(5);
        console.log(`Found ${assessments.length} assessments`);
        assessments.forEach((a, i) => {
            console.log(`${i}: Title: ${a.title}, Questions: ${a.questions.length}, Internal: ${a.isInternal}`);
        });

        const results = await AssessmentResult.find().sort({ completedAt: -1 }).limit(5);
        console.log(`Found ${results.length} results`);
        results.forEach((r, i) => {
            console.log(`${i}: Score: ${r.score}, Internal: ${r.isInternal}`);
        });

        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}
check();
