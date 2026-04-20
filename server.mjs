import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import http from "node:http";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import mongoose from "mongoose";
import nodemailer from "nodemailer";
import OpenAI from "openai";
import { Server } from "socket.io";
import { createAuthMiddleware } from "./src/middleware/auth.mjs";
import { CameraAttendance, CandidateInvitation, ConversationMessage, User } from "./src/models/index.mjs";
import { registerAuthRoutes } from "./src/routes/registerAuthRoutes.mjs";
import { registerAvatarRoutes } from "./src/routes/registerAvatarRoutes.mjs";
import { registerAttendanceRoutes } from "./src/routes/registerAttendanceRoutes.mjs";
import { registerParsingRoutes } from "./src/routes/registerParsingRoutes.mjs";
import { registerSocketHandlers } from "./src/socket/registerSocketHandlers.mjs";

dotenv.config();

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 4000);
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const jwtSecret = process.env.JWT_SECRET || "dev-secret";
const mongoUri = process.env.MONGODB_URI || "";
const mongoDbName = process.env.MONGODB_DB_NAME || "ai_mentor_app";
const otpExpiryMinutes = Number(process.env.OTP_EXPIRY_MINUTES || 1);
const openAiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
const deepgramTtsModel = process.env.DEEPGRAM_TTS_MODEL || "aura-2-thalia-en";
const deepgramSttModel = process.env.DEEPGRAM_STT_MODEL || "nova-2";
const livekitUrl = process.env.LIVEKIT_URL || "";
const livekitApiKey = process.env.LIVEKIT_API_KEY || "";
const livekitApiSecret = process.env.LIVEKIT_API_SECRET || "";
const livekitAgentName = process.env.LIVEKIT_AGENT_NAME || "ai-mentor-bey-agent";
const adminEmail = (process.env.ADMIN_EMAIL || "admin@aimentor.local").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const avatarIdentity = process.env.BEY_AVATAR_IDENTITY || "bey-avatar-agent";
const candidateAppUrl = process.env.CANDIDATE_APP_URL || frontendOrigin;
const internalApiKey = process.env.INTERNAL_API_KEY || jwtSecret;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const roomServiceClient =
  livekitUrl && livekitApiKey && livekitApiSecret
    ? new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret)
    : null;
const agentDispatchClient =
  livekitUrl && livekitApiKey && livekitApiSecret
    ? new AgentDispatchClient(livekitUrl.replace(/^wss:/, "https:"), livekitApiKey, livekitApiSecret)
    : null;

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SMTP_HOST || "smtp.office365.com",
  port: Number(process.env.EMAIL_SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: true,
  },
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: "*" }));
app.use(express.json());

function validateEnv() {
  const required = [
    "MONGODB_URI",
    "JWT_SECRET",
    "EMAIL_USER",
    "EMAIL_PASS",
    "OPENAI_API_KEY",
    "DEEPGRAM_API_KEY",
    "BEY_API_KEY",
    "BEY_AVATAR_ID",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.warn(`Missing env vars: ${missing.join(", ")}`);
  }
}

async function connectDatabase() {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing.");
  }
  await mongoose.connect(mongoUri, { dbName: mongoDbName });
  console.log("MongoDB connected.");
}

const { verifyHttpAuth, verifyAdminAuth } = createAuthMiddleware(jwtSecret);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

registerAuthRoutes(app, {
  User,
  CameraAttendance,
  CandidateInvitation,
  verifyHttpAuth,
  internalApiKey,
  jwtSecret,
  otpExpiryMinutes,
  adminEmail,
  adminPassword,
  verifyAdminAuth,
  openai,
  openAiModel,
  transporter,
  emailUser: process.env.EMAIL_USER,
  candidateAppUrl,
});

registerAvatarRoutes(app, {
  verifyHttpAuth,
  roomServiceClient,
  agentDispatchClient,
  livekitUrl,
  livekitApiKey,
  livekitApiSecret,
  livekitAgentName,
  avatarIdentity,
});

registerAttendanceRoutes(app, {
  CameraAttendance,
  CandidateInvitation,
  verifyHttpAuth,
  verifyAdminAuth,
  internalApiKey,
});

registerParsingRoutes(app, {
  verifyHttpAuth,
  openai,
});

registerSocketHandlers(io, {
  jwtSecret,
  openai,
  openAiModel,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY,
  deepgramSttModel,
  deepgramTtsModel,
  ConversationMessage,
});

validateEnv();

try {
  await connectDatabase();
  server.listen(port, () => {
    console.log(`Node API + socket running on http://localhost:${port}`);
  });
} catch (error) {
  console.error("Startup failed:", error.message);
  process.exit(1);
}
