import multer from "multer";
import { createParsingController } from "../controllers/parsingController.mjs";

const upload = multer({ storage: multer.memoryStorage() });

/**
 * Registers parsing routes to the express application.
 */
export const registerParsingRoutes = (app, { verifyHttpAuth, openai }) => {
  const controller = createParsingController(openai);

  // Parse and save study plan
  app.post(
    "/parse-study-plan",
    verifyHttpAuth,
    upload.single("pdfFile"),
    controller.parseStudyPlan
  );

  // Parse and save study material
  app.post(
    "/parse-study-material",
    verifyHttpAuth,
    upload.single("pdfFile"),
    controller.parseStudyMaterial
  );
};
