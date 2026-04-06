import express from "express";
import { HEALTH_PORT } from "./config.js";

export function startHealthServer() {
  const app = express();

  app.get("/health", (_req, res) => {
    res.json({
      service: "voice-agent-service",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.listen(HEALTH_PORT, () => {
    console.log(`voice-agent-service health server running on :${HEALTH_PORT}`);
  });
}
