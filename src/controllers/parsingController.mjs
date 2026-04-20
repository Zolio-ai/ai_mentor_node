import { parseAndSaveStudyPlan, parseAndSaveStudyMaterial } from "../services/parsingService.mjs";

/**
 * Controller for handling parsing requests.
 */
export const createParsingController = (openai) => {
  const parseStudyPlan = async (req, res) => {
    try {
      const { planName } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ success: false, message: "Please upload a PDF file" });
      }

      const plan = await parseAndSaveStudyPlan(openai, file.buffer, file.originalname, planName);
      res.status(201).json({ success: true, data: plan });
    } catch (error) {
      console.error("Error parsing study plan:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  const parseStudyMaterial = async (req, res) => {
    try {
      const { subject } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ success: false, message: "Please upload a PDF file" });
      }

      const material = await parseAndSaveStudyMaterial(openai, file.buffer, file.originalname, subject);
      res.status(201).json({ success: true, data: material });
    } catch (error) {
      console.error("Error parsing study material:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  };

  return { parseStudyPlan, parseStudyMaterial };
};
