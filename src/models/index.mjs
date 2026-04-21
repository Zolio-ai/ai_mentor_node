import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    firstName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
    phonenumber: { type: String, default: "", trim: true },
    stream: { type: String, default: "", trim: true },
    class: { type: Number, default: null },
    marks: {
      physics: { type: Number, default: null },
      chemistry: { type: Number, default: null },
      maths: { type: Number, default: null },
      biology: { type: Number, default: null },
    },
    cgpa10: { type: Number, default: null },
    entranceExam: { type: String, default: "", trim: true },
    onboardingCompleted: { type: Boolean, default: false },
    passwordHash: { type: String, default: null },
    otp: { type: String, default: null },
    otpExpires: { type: Date, default: null },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const cameraAttendanceSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    roomName: { type: String, default: null },
    status: {
      type: String,
      enum: ["present", "away", "checking", "error"],
      required: true,
    },
    note: { type: String, default: "" },
    cameraOn: { type: Boolean, default: false },
    avatarReady: { type: Boolean, default: false },
    personDetected: { type: Boolean, default: false },
    clientTs: { type: Date, default: null },
    samples: [
      {
        at: { type: Date, default: Date.now },
        status: {
          type: String,
          enum: ["present", "away", "checking", "error"],
          required: true,
        },
        note: { type: String, default: "" },
        cameraOn: { type: Boolean, default: false },
        avatarReady: { type: Boolean, default: false },
        personDetected: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true },
);

const candidateInvitationSchema = new mongoose.Schema(
  {
    candidateName: { type: String, default: "", trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    invitedBy: { type: String, default: "admin", trim: true },
    inviteCount: { type: Number, default: 1 },
    firstInvitedAt: { type: Date, default: Date.now },
    lastInvitedAt: { type: Date, default: Date.now },
    trainingCompleted: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const conversationMessageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    roomName: { type: String, default: "", index: true },
    role: { type: String, enum: ["user", "assistant"], required: true, index: true },
    text: { type: String, required: true, trim: true },
    speechId: { type: String, default: "", trim: true },
    interrupted: { type: Boolean, default: false },
    source: { type: String, default: "voice-agent", trim: true },
  },
  { timestamps: true },
);

const studyPlanSchema = new mongoose.Schema(
  {
    planName: { type: String, default: "General Plan", trim: true },
    weeks: [
      {
        weekNumber: { type: Number, default: null },
        title: { type: String, default: "", trim: true },
        topics: [{ type: String, default: "", trim: true }],
      },
    ],
    rawContent: { type: String, default: "" },
  },
  { timestamps: true },
);

const studyMaterialSchema = new mongoose.Schema(
  {
    subject: { type: String, default: "General", trim: true },
    fileName: { type: String, default: "", trim: true },
    chapters: [
      {
        chapterNumber: { type: Number, default: null },
        chapterTitle: { type: String, default: "", trim: true },
        topics: [
          {
            title: { type: String, default: "", trim: true },
            content: { type: String, default: "" },
            media: [
              {
                type: { type: String, default: "", trim: true },
                description: { type: String, default: "" },
                content: { type: String, default: "" },
              },
            ],
          },
        ],
      },
    ],
    rawContent: { type: String },
    fileData: { type: Buffer },
    fileType: { type: String, default: "application/pdf" },
  },
  { timestamps: true },
);

const studyProgressSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    studyMaterialId: { type: mongoose.Schema.Types.ObjectId, ref: "StudyMaterial", required: true },
    currentChapterIndex: { type: Number, default: 0 },
    currentTopicIndex: { type: Number, default: 0 },
    isCompleted: { type: Boolean, default: false },
    lastAccessedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const User = mongoose.model("User", userSchema);
export const CameraAttendance = mongoose.model("CameraAttendance", cameraAttendanceSchema);
export const CandidateInvitation = mongoose.model("CandidateInvitation", candidateInvitationSchema);
export const ConversationMessage = mongoose.model("ConversationMessage", conversationMessageSchema);
export const StudyPlan = mongoose.model("StudyPlan", studyPlanSchema);
export const StudyMaterial = mongoose.model("StudyMaterial", studyMaterialSchema);
export const StudyProgress = mongoose.model("StudyProgress", studyProgressSchema);
