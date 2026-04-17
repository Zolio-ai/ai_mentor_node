const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates assessment questions from study material content.
 */
const generateQuestions = async (content, title) => {
    const prompt = `
        You are an expert educator. Based on the following study material content for "${title}", generate a set of assessment questions.
        Return ONLY a JSON object with the following structure:
        {
            "questions": [
                {
                    "questionText": "Question here?",
                    "options": ["Option A", "Option B", "Option C", "Option D"],
                    "correctAnswer": "Option A",
                    "type": "mcq"
                }
            ]
        }
        Generate EXACTLY 10 high-quality multiple-choice questions. It is CRITICAL that you provide exactly 10 questions, no more and no fewer. Ensure the distractors are plausible.
        
        Content:
        ${content.substring(0, 10000)} // Limiting content length for context window
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    return JSON.parse(response.choices[0].message.content);
};

/**
 * Generates assessment questions based purely on topic descriptions.
 */
const generateQuestionsByTopics = async (topicNames, subject) => {
    const prompt = `
        You are an expert educator. Generate an assessment test for the subject "${subject}" specifically covering the following topics:
        ${topicNames.join(', ')}

        Return ONLY a JSON object with the following structure:
        {
            "questions": [
                {
                    "questionText": "Question here?",
                    "options": ["Option A", "Option B", "Option C", "Option D"],
                    "correctAnswer": "Option A",
                    "type": "mcq"
                }
            ]
        }
        Generate EXACTLY 10 high-quality multiple-choice questions total, distributing them evenly across the topics. It is CRITICAL that you provide exactly 10 questions, no more and no fewer. Ensure the distractors are plausible.
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    return JSON.parse(response.choices[0].message.content);
};

/**
 * Generates assessment questions from study material content filtered by specific topics.
 */
const generateQuestionsByTopicsFromContent = async (topicNames, content, subject) => {
    const prompt = `
        You are an expert educator. Based on the following study material content for "${subject}", generate assessment questions specifically covering these topics:
        ${topicNames.join(', ')}

        Use ONLY the information from the content below related to these topics. If a topic is not clearly covered in the content, generate a general question about that topic.

        Return ONLY a JSON object with the following structure:
        {
            "questions": [
                {
                    "questionText": "Question here?",
                    "options": ["Option A", "Option B", "Option C", "Option D"],
                    "correctAnswer": "Option A",
                    "type": "mcq"
                }
            ]
        }
        Generate EXACTLY 10 high-quality multiple-choice questions total, distributing them evenly across the topics. It is CRITICAL that you provide exactly 10 questions, no more and no fewer. Ensure the distractors are plausible.

        Content:
        ${content.substring(0, 15000)} // Limiting content length for context window
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    return JSON.parse(response.choices[0].message.content);
};

/**
 * Analyzes user answers against the questions.
 */
const analyzeAssessment = async (questions, userAnswers) => {
    const prompt = `
        You are an academic mentor. Evaluation the user's answers against the questions provided.
        Questions and Correct Answers: ${JSON.stringify(questions)}
        User Answers: ${JSON.stringify(userAnswers)}

        Return ONLY a JSON object with this structure:
        {
            "responses": [
                {
                    "questionText": "...",
                    "userAnswer": "...",
                    "isCorrect": true/false,
                    "feedback": "Short explanation"
                }
            ],
            "score": 80, // percentage
            "analysis": {
                "strengths": ["Topic A", "Topic B"],
                "weaknesses": ["Topic C"],
                "overallFeedback": "Overall performance summary"
            }
        }
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    return JSON.parse(response.choices[0].message.content);
};

module.exports = {
    generateQuestions,
    generateQuestionsByTopics,
    generateQuestionsByTopicsFromContent,
    analyzeAssessment
};
