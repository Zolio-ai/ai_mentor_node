const Assessment = require('../models/assessment');
const AssessmentResult = require('../models/assessmentResult');
const StudyMaterial = require('../models/studyMaterial');
const StudentStudyPlan = require('../models/studentStudyPlan');
const { updateMasteryFromAssessment, getCurrentWeekProgress } = require('../services/dataService');
const openaiService = require('../services/openaiService');
const logger = require('../utils/logger');

/**
 * Generate a new assessment based on study material
 */
exports.generateAssessment = async (req, res) => {
    try {
        const { materialId, topics } = req.body;
        const studentId = req.user._id;
        
        let generatedData;
        let assessmentTitle;
        let finalTopics = topics || [];
        
        // 1. Resolve Study Material & Student Plan
        const studentPlan = await StudentStudyPlan.findOne({ 
            studentId, 
            isActive: true 
        }).populate('studyMaterialId');

        let studyMaterialId = materialId || studentPlan?.studyMaterialId?._id || null;

        // 2. Resolve Topics (Intelligent Fallback)
        if (!finalTopics || finalTopics.length === 0) {
            // No topics specified? Find current week topics from the study plan
            const weekProgress = await getCurrentWeekProgress(studentId);
            if (weekProgress && weekProgress.allTopics.length > 0) {
                finalTopics = weekProgress.allTopics;
                assessmentTitle = `Quiz: Week ${weekProgress.weekNumber} Review`;
                logger.debug({ week: weekProgress.weekNumber, topics: finalTopics }, 'Injected current week topics for assessment');
            }
        }

        // 3. Perform Generation
        if (finalTopics && finalTopics.length > 0) {
            // Topic-based generation
            if (!assessmentTitle) {
                assessmentTitle = `Quiz: ${finalTopics.slice(0, 2).join(', ')}`;
            }
            
            if (studentPlan?.studyMaterialId) {
                const material = studentPlan.studyMaterialId;
                const content = material.rawContent || material.chapters.map(c => c.content).join('\n');
                generatedData = await openaiService.generateQuestionsByTopicsFromContent(
                    finalTopics,
                    content,
                    material.subject
                );
            } else {
                generatedData = await openaiService.generateQuestionsByTopics(finalTopics, 'General');
            }
        } else if (studyMaterialId) {
            // Material-based generation (Fallback to general material review)
            const material = await StudyMaterial.findById(studyMaterialId);
            if (!material) {
                return res.status(404).json({ success: false, message: 'Study material not found' });
            }
            assessmentTitle = `Assessment: ${material.subject}`;
            const content = material.rawContent || material.chapters.map(c => c.content).join('\n');
            generatedData = await openaiService.generateQuestions(content, material.subject);
        } else {
            return res.status(400).json({ 
                success: false, 
                message: 'Could not generate assessment: No topics or study plan found. Please upload a study material first.' 
            });
        }

        // 4. Save and Return
        const newAssessment = new Assessment({
            studyMaterialId,
            title: assessmentTitle,
            questions: generatedData.questions,
            topics: finalTopics
        });

        await newAssessment.save();
        
        logger.info({ assessmentId: newAssessment._id, title: newAssessment.title }, 'Dynamic assessment generated');
        res.status(201).json({
            success: true,
            data: newAssessment
        });
    } catch (error) {
        logger.error({ error: error.message, stack: error.stack }, 'Error generating assessment');
        res.status(500).json({ success: false, message: 'Failed to generate assessment', error: error.message });
    }
};



/**
 * Submit assessment answers and get analysis
 */
exports.submitAssessment = async (req, res) => {
    try {
        const { assessmentId, responses, answers } = req.body;
        const finalAnswers = responses || answers; 
        
        if (!finalAnswers) {
            return res.status(400).json({ success: false, message: 'Missing answers/responses in request body' });
        }
        
        const assessment = await Assessment.findById(assessmentId);
        if (!assessment) {
            return res.status(404).json({ message: 'Assessment not found' });
        }

        const questionsForAI = assessment.questions.map(q => ({
            questionText: q.questionText,
            correctAnswer: q.correctAnswer,
            options: q.options
        }));

        const analysisData = await openaiService.analyzeAssessment(questionsForAI, answers);

        const newResult = new AssessmentResult({
            assessmentId,
            studentId: req.user._id, // Set from authMiddleware
            responses: analysisData.responses,
            score: analysisData.score,
            analysis: analysisData.analysis
        });

        await newResult.save();

        logger.info({ resultId: newResult._id, score: newResult.score }, 'Standard assessment submitted');

        // New: Update study plan mastery based on this assessment
        try {
            await updateMasteryFromAssessment(req.user._id, analysisData.analysis);
        } catch (masteryError) {
            logger.error({ error: masteryError.message }, 'Failed to update study plan mastery');
            // We don't fail the whole request if mastery update fails, but we log it
        }

        res.status(201).json({
            success: true,
            data: newResult
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Error submitting assessment');
        res.status(500).json({ message: 'Failed to submit assessment', error: error.message });
    }
};

/**
 * Generate assessment specifically for the Voice Agent (by topics)
 * Validates that topics are from the current week's study plan only.
 */
exports.generateInternalAssessment = async (req, res) => {
    logger.info({ studentId: req.body.studentId, topicNames: req.body.topicNames }, 'Internal generate endpoint reached');
    try {
        const { studentId, topicNames, subject, secret } = req.body;

        // Security check
        if (secret !== process.env.INTERNAL_KEY) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        // Validate studentId format
        if (!studentId || studentId.length !== 24) {
            return res.status(400).json({ success: false, message: 'Invalid studentId format' });
        }

        // Get current week topics to validate against
        const weekProgress = await getCurrentWeekProgress(studentId);
        if (!weekProgress) {
            return res.status(400).json({ success: false, message: 'No active study plan found for student' });
        }

        const currentWeekTopics = weekProgress.allTopics.map(t => t.toLowerCase().trim());

        let exactTopicNames;

        if (!topicNames || topicNames.length === 0) {
            // If the AI leaves the array empty, automatically test everything from the current week!
            exactTopicNames = weekProgress.allTopics;
        } else {
            // Validate that all requested topics are from current week (case-insensitive match or substring)
            const invalidTopics = topicNames.filter(requestedTopic => {
                const normalizedRequested = requestedTopic.toLowerCase().trim();
                return !currentWeekTopics.some(currentTopic => currentTopic.includes(normalizedRequested));
            });

            if (invalidTopics.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: `Cannot test topics not in current week. Invalid topics: ${invalidTopics.join(', ')}. Current week topics: ${weekProgress.allTopics.join(', ')}`,
                    currentWeekTopics: weekProgress.allTopics
                });
            }

            // All topics valid - grab exact names
            exactTopicNames = topicNames.map(requestedTopic => {
                const normalizedRequested = requestedTopic.toLowerCase().trim();
                return weekProgress.allTopics.find(currentTopic =>
                    currentTopic.toLowerCase().includes(normalizedRequested)
                ) || requestedTopic;
            });
        }

        // Get student's assigned study material for content-based questions
        const studentPlan = await StudentStudyPlan.findOne({ studentId, isActive: true }).populate('studyMaterialId');
        let generatedData;

        if (studentPlan?.studyMaterialId) {
            // Use study material content for topic-specific questions
            const material = studentPlan.studyMaterialId;
            const content = material.rawContent || material.chapters.map(c => c.content).join('\n');
            generatedData = await openaiService.generateQuestionsByTopicsFromContent(
                exactTopicNames,
                content,
                material.subject
            );
        } else {
            // Fallback to generic topic-based generation
            generatedData = await openaiService.generateQuestionsByTopics(exactTopicNames, subject || 'General');
        }

        const newAssessment = new Assessment({
            title: `Week ${weekProgress.weekNumber} Test: ${exactTopicNames.slice(0, 2).join(', ')}`,
            questions: generatedData.questions,
            isInternal: true,
            weekNumber: weekProgress.weekNumber,
            topics: exactTopicNames,
            studyMaterialId: studentPlan?.studyMaterialId?._id || null
        });

        await newAssessment.save();

        logger.info({ assessmentId: newAssessment._id, week: newAssessment.weekNumber }, 'Internal assessment saved');
        logger.debug({ questions: newAssessment.questions }, 'Generated questions for Voice AI');

        res.status(201).json({
            success: true,
            message: 'Internal assessment generated',
            assessmentId: newAssessment._id,
            weekNumber: weekProgress.weekNumber,
            currentWeekTopics: weekProgress.allTopics,
            testedTopics: exactTopicNames,
            data: newAssessment
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Error generating internal assessment');
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Submit assessment answers specifically for the Voice Agent
 * Protected by INTERNAL_KEY secret
 */
exports.submitInternalAssessment = async (req, res) => {
    logger.info({ studentId: req.body.studentId, assessmentId: req.body.assessmentId }, 'Internal submit endpoint reached');
    try {
        const { assessmentId, studentId, answers, secret } = req.body;

        // Security check
        if (secret !== process.env.INTERNAL_KEY) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        // Validate studentId format
        if (!studentId || studentId.length !== 24) {
            return res.status(400).json({ success: false, message: 'Invalid studentId format' });
        }

        const assessment = await Assessment.findById(assessmentId);
        if (!assessment) {
            return res.status(404).json({ success: false, message: 'Assessment not found' });
        }

        const questionsForAI = assessment.questions.map(q => ({
            questionText: q.questionText,
            correctAnswer: q.correctAnswer,
            options: q.options
        }));

        const analysisData = await openaiService.analyzeAssessment(questionsForAI, answers);

        const newResult = new AssessmentResult({
            assessmentId,
            studentId, // From body instead of req.user
            responses: analysisData.responses,
            score: analysisData.score,
            analysis: analysisData.analysis,
            isInternal: true
        });

        await newResult.save();

        logger.info({ resultId: newResult._id, score: newResult.score }, 'Internal assessment results saved');

        // Update study plan mastery based on this assessment
        try {
            await updateMasteryFromAssessment(studentId, analysisData.analysis);
        } catch (masteryError) {
            logger.error({ error: masteryError.message }, 'Failed to update internal study plan mastery');
            // We don't fail the whole request if mastery update fails, but we log it
        }

        res.status(201).json({
            success: true,
            message: 'Internal assessment submitted and scored successfully',
            data: newResult
        });
    } catch (error) {
        logger.error({ error: error.message }, 'Error submitting internal assessment');
        res.status(500).json({ success: false, message: 'Failed to submit internal assessment', error: error.message });
    }
};
