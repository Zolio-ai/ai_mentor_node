const { PDFParse } = require('pdf-parse');
const Student = require('../models/student');
const StudentData = require('../models/studentData');
const StudyMaterial = require('../models/studyMaterial');
const StudyPlan = require('../models/studyPlan');
const StudentStudyPlan = require('../models/studentStudyPlan');
const Reminder = require('../models/reminder');


const onboardStudent = async (studentId, academicData) => {
    const { stream, class: studentClass, cgpa, marks, entrance } = academicData;

    // Create or Update student data
    const data = await StudentData.findOneAndUpdate(
        { studentId },
        { stream, class: studentClass, cgpa, marks, entrance },
        { returnDocument: 'after', upsert: true }
    );
    
    return data;
};

const getFullProfile = async (studentId) => {
    // 1. Fetch student details but EXCLUDE the password
    const student = await Student.findById(studentId).select('-password');
    if (!student) throw new Error('Student account not found');
    
    // 2. Fetch the academic data for this student
    const academicData = await StudentData.findOne({ studentId });

    // 3. Return both combined
    return {
        ...student.toObject(),
        academic: academicData || null
    };
};

const getFullMarks = async (studentId) => {
    const marks = await StudentData.findOne({ studentId}).select('marks');
    if (!marks) {
        throw new Error('No academic records found for this student');
    }
    return marks;
}
const parseAndSaveStudyMaterial = async (pdfBuffer, fileName, subject) => {
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    
    const lines = result.text.split('\n');
    const chapters = [];
    let currentChapter = null;
    let contentBuffer = [];

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const chapterMatch = line.match(/^Chapter\s+(\d+):\s+(.*)$/i);
        
        if (chapterMatch) {
            if (currentChapter) {
                currentChapter.content = contentBuffer.join('\n');
                chapters.push(currentChapter);
            }
            currentChapter = {
                chapterNumber: parseInt(chapterMatch[1]),
                title: chapterMatch[2],
                content: ''
            };
            contentBuffer = []; 
        } else if (currentChapter) {
            contentBuffer.push(line);
        }
    }
    if (currentChapter) {
        currentChapter.content = contentBuffer.join('\n');
        chapters.push(currentChapter);
    }
    
    const newMaterial = new StudyMaterial({
        subject: subject || 'General',
        fileName: fileName,
        chapters: chapters,
        rawContent: result.text
    });
    
    await newMaterial.save();
    return newMaterial;
};

const parseAndSaveStudyPlan = async (pdfBuffer, fileName, planName) => {
    const parser = new PDFParse({ data: pdfBuffer });
    const result = await parser.getText();
    const data = { text: result.text };
    
    const lines = data.text.split('\n');
    const weeks = [];
    let currentWeek = null;
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        // Allow Week X: Title, Week X - Title, or Week X Title
        const weekMatch = line.match(/^Week\s+(\d+)\s*[:\-\s]\s*(.*)$/i);
        const bulletMatch = line.match(/^[●•\-*]\s*(.+)$/);

        if (weekMatch) {
            if (currentWeek) weeks.push(currentWeek); 
            currentWeek = { 
                weekNumber: parseInt(weekMatch[1]), 
                title: weekMatch[2].trim(), 
                topics: [] 
            };
        } else if (currentWeek && bulletMatch) {
            currentWeek.topics.push(bulletMatch[1].trim()); 
        }
    }
    if (currentWeek) weeks.push(currentWeek); 

    const newPlan = new StudyPlan({
        planName: planName || 'General Plan',
        weeks: weeks,
        rawContent: data.text
    });
    
    await newPlan.save();
    return newPlan;
};

const assignPlanToStudent = async (studentId, planId, startDateStr) => {
    // Check if plan exists
    const plan = await StudyPlan.findById(planId);
    if (!plan) throw new Error('Study plan not found');

    // Deactivate a previous active plan so they don't clash
    await StudentStudyPlan.updateMany(
        { studentId, planId: { $ne: planId }, isActive: true },
        { isActive: false }
    );

    const updateFields = { studentId, planId, isActive: true };
    if (startDateStr) {
        updateFields.startDate = new Date(startDateStr);
    }

    // Create or update assignment
    const assignment = await StudentStudyPlan.findOneAndUpdate(
        { studentId, planId },
        updateFields,
        { upsert: true, new: true }
    );
    return assignment;
};

const getCurrentWeekProgress = async (studentId) => {
    const assignment = await StudentStudyPlan.findOne({ studentId, isActive: true }).populate('planId');
    if (!assignment) return null;

    const startDate = new Date(assignment.startDate);
    startDate.setHours(0, 0, 0, 0); // Normalize to midnight
    
    const now = new Date();
    now.setHours(0, 0, 0, 0); // Normalize to midnight
    
    const diffTime = now.getTime() - startDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const currentWeekNumber = Math.floor(diffDays / 7) + 1;
    const isLastDayOfWeek = diffDays % 7 === 6;

    const plan = assignment.planId;
    const currentWeekData = plan.weeks.find(w => w.weekNumber === currentWeekNumber);

    if (!currentWeekData) {
        return { 
            weekNumber: currentWeekNumber, 
            weekTitle: 'No Title', 
            allTopics: [], 
            topicStatus: [], 
            isWeekCompleted: false,
            isLastDayOfWeek 
        };
    }

    const completedTopicNames = assignment.completedTopics.map(t => t.topicName.toLowerCase().trim());
    const masteredTopicNames = assignment.masteredTopics?.map(t => t.topicName.toLowerCase().trim()) || [];
    const weaknessTopicNames = assignment.weaknessTopics?.map(t => t.topicName.toLowerCase().trim()) || [];
    
    return {
        weekNumber: currentWeekNumber,
        weekTitle: currentWeekData.title,
        allTopics: currentWeekData.topics,
        topicStatus: currentWeekData.topics.map(topic => {
            const normalizedTopic = topic.toLowerCase().trim();
            if (masteredTopicNames.includes(normalizedTopic)) return { topic, status: 'MASTERED' };
            if (weaknessTopicNames.includes(normalizedTopic)) return { topic, status: 'NEEDS_RETEST' };
            if (completedTopicNames.includes(normalizedTopic)) return { topic, status: 'READ_BUT_UNTESTED' };
            return { topic, status: 'UNTOUCHED' };
        }),
        isWeekCompleted: currentWeekData.topics.every(t => masteredTopicNames.includes(t.toLowerCase().trim())),
        isLastDayOfWeek
    };
};

const updateMasteryFromAssessment = async (studentId, analysis) => {
    const assignment = await StudentStudyPlan.findOne({ studentId, isActive: true });
    if (!assignment) return null;

    const { strengths = [], weaknesses = [] } = analysis;

    for (const topic of strengths) {
        const normalizedTopicName = topic.trim();
        // Case-insensitive removal from weaknesses
        assignment.weaknessTopics = assignment.weaknessTopics.filter(t => t.topicName.toLowerCase().trim() !== normalizedTopicName.toLowerCase());
        
        // Case-insensitive check before add
        if (!assignment.masteredTopics.some(t => t.topicName.toLowerCase().trim() === normalizedTopicName.toLowerCase())) {
            assignment.masteredTopics.push({ topicName: normalizedTopicName });
        }
    }

    for (const topic of weaknesses) {
        const normalizedTopicName = topic.trim();
        // Case-insensitive removal from mastered
        assignment.masteredTopics = assignment.masteredTopics.filter(t => t.topicName.toLowerCase().trim() !== normalizedTopicName.toLowerCase());
        
        // Case-insensitive check or update
        const existingWeaknessIdx = assignment.weaknessTopics.findIndex(t => t.topicName.toLowerCase().trim() === normalizedTopicName.toLowerCase());
        if (existingWeaknessIdx === -1) {
            assignment.weaknessTopics.push({ topicName: normalizedTopicName });
        } else {
            assignment.weaknessTopics[existingWeaknessIdx].identifiedAt = new Date();
        }
    }

    await assignment.save();
    return assignment;
};

const updateTopicCompletion = async (studentId, topicName) => {
    const assignment = await StudentStudyPlan.findOne({ studentId, isActive: true });
    if (!assignment) throw new Error('No active study plan found');

    // Case-insensitive check
    if (assignment.completedTopics.some(t => t.topicName.toLowerCase().trim() === topicName.toLowerCase().trim())) {
        return assignment;
    }

    assignment.completedTopics.push({ topicName });
    await assignment.save();
    return assignment;
};

const createReminder = async (studentId, topicName, type = 'TOPIC_PENDING', scheduledDate = null) => {
    // Parse scheduledDate into a proper Date object if provided
    let parsedDate = null;
    if (scheduledDate) {
        const dateObj = new Date(scheduledDate);
        if (!isNaN(dateObj.getTime())) {
            parsedDate = dateObj;
        }
    }

    const reminder = new Reminder({
        studentId,
        topicName,
        type,
        scheduledDate: parsedDate,
        isResolved: false
    });
    await reminder.save();
    return reminder;
};

const getActiveReminders = async (studentId) => {
    const now = new Date();
    // Fetch unresolved reminders or tests scheduled for today or before
    const reminders = await Reminder.find({
        studentId,
        isResolved: false,
        $or: [
            { type: 'TOPIC_PENDING' },
            { type: 'TEST_SCHEDULED', scheduledDate: { $lte: now } }
        ]
    }).sort({ createdAt: 1 });
    return reminders;
};

const resolveReminder = async (studentId, topicName, type) => {
    const result = await Reminder.updateMany(
        { studentId, topicName, type, isResolved: false },
        { isResolved: true }
    );
    return result;
};

const assignStudyMaterialToStudent = async (studentId, materialId) => {
    // Find active study plan assignment
    const assignment = await StudentStudyPlan.findOne({ studentId, isActive: true });
    if (!assignment) throw new Error('No active study plan found for student');

    // Verify material exists
    const material = await StudyMaterial.findById(materialId);
    if (!material) throw new Error('Study material not found');

    // Update assignment with material
    assignment.studyMaterialId = materialId;
    await assignment.save();

    return {
        assignment,
        material: { subject: material.subject, fileName: material.fileName }
    };
};

const getAllPlans = async () => {
    return await StudyPlan.find({}).select('-rawContent');
};

const getAllMaterials = async () => {
    // Return materials without large rawContent or full chapter text for list view
    return await StudyMaterial.find({}).select('-rawContent -chapters.content');
};

const getStudentActivePlan = async (studentId) => {
    return await StudentStudyPlan.findOne({ studentId, isActive: true })
        .populate('planId')
        .populate('studyMaterialId', 'subject fileName chapters.title chapters.chapterNumber');
};

module.exports = {
    onboardStudent,
    getFullProfile,
    getFullMarks,
    parseAndSaveStudyMaterial,
    parseAndSaveStudyPlan,
    assignPlanToStudent,
    assignStudyMaterialToStudent,
    getCurrentWeekProgress,
    getAllPlans,
    getAllMaterials,
    getStudentActivePlan,
    updateTopicCompletion,
    createReminder,
    getActiveReminders,
    resolveReminder,
    updateMasteryFromAssessment
}
