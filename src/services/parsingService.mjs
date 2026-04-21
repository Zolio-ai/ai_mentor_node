import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import { StudyPlan, StudyMaterial } from "../models/index.mjs";

/**
 * Parses a study plan PDF and saves it to the database.
 * Structured by Week -> Topics.
 */
export const parseAndSaveStudyPlan = async (openai, buffer, fileName, planName) => {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = result.text;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are an expert educational content parser. Your goal is to extract a study plan from the provided text and structure it into a JSON format with weeks and topics.",
      },
      {
        role: "user",
        content: `Extract the study plan from the following text and return it as a JSON object with the following structure:
{
  "weeks": [
    {
      "weekNumber": number,
      "title": "string",
      "topics": ["string"]
    }
  ]
}

Ensure all topics are captured and assigned to the correct week.

Text:
${text}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsedData = JSON.parse(response.choices[0].message.content);

  const studyPlan = new StudyPlan({
    planName: planName || "General Plan",
    weeks: parsedData.weeks,
    rawContent: text,
  });

  await studyPlan.save();
  return studyPlan;
};

/**
 * Parses study material PDF and saves it to the database.
 * Structured by Chapters -> Topics.
 */
export const parseAndSaveStudyMaterial = async (openai, buffer, fileName, subject) => {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const text = result.text;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: "You are an expert educational content parser. Your goal is to extract study material from the provided text and structure it into a Chapter-wise format with topics. Each topic should have detailed content, including LaTeX for any formulas. Identify any mentions of images, graphs, or charts and provide descriptions for them.",
      },
      {
        role: "user",
        content: `Extract the study material from the following text and return it as a JSON object with the following structure:
{
  "chapters": [
    {
      "chapterNumber": number,
      "chapterTitle": "string",
      "topics": [
        {
          "title": "string",
          "content": "string (detailed markdown/text)",
          "media": [
            {
              "type": "image" | "graph" | "formula" | "table" | "diagram",
              "description": "string (description of the image, graph, table, or diagram)",
              "content": "string (LaTeX for formula, or empty for others)"
            }
          ]
        }
      ]
    }
  ]
}

Note: Ensure chapters and topics are extracted logically. Use LaTeX for all mathematical formulas.

Text:
${text}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsedData = JSON.parse(response.choices[0].message.content);

  const studyMaterial = new StudyMaterial({
    subject: subject || "General",
    fileName,
    chapters: parsedData.chapters,
    rawContent: text,
    fileData: buffer,
    fileType: "application/pdf",
  });

  await studyMaterial.save();
  return studyMaterial;
};
