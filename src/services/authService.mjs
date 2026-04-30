import jwt from "jsonwebtoken";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { buildAttendanceInsights } from "./attendanceInsights.mjs";
import { initializeTaskFlowForNewUser } from "./taskService.mjs";

function createHttpError(status, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, saved] = storedHash.split(":");
  const hash = pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
  const savedBuffer = Buffer.from(saved, "hex");
  const hashBuffer = Buffer.from(hash, "hex");
  if (savedBuffer.length !== hashBuffer.length) return false;
  return timingSafeEqual(savedBuffer, hashBuffer);
}

function invitationTemplate(candidateName, candidateEmail, inviteUrl) {
  const safeName = String(candidateName || "").trim();
  const greeting = safeName ? `Dear ${safeName},` : "Hello,";
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; color: #111827;">
      <h2 style="margin-bottom: 8px;">AI Mentor Session Invitation</h2>
      <p style="margin-top: 0;">${greeting}</p>
      <p style="margin-top: 0;">You have been invited to join your AI Mentor session for guided preparation and doubt clearing.</p>
      <p>Please use the link below to access your mentor portal:</p>
      <p style="margin: 18px 0;">
        <a href="${inviteUrl}" style="display: inline-block; background: #1a1a2e; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px;">
          Open AI Mentor
        </a>
      </p>
      <p style="font-size: 14px; color: #4b5563;">Candidate email: <strong>${candidateEmail}</strong></p>
      <p style="font-size: 13px; color: #6b7280;">If you were not expecting this invite, please ignore this email.</p>
    </div>
  `;
}

async function sendInvitationMail(transporter, emailUser, candidateName, candidateEmail, inviteUrl) {
  await transporter.sendMail({
    from: `"AI Mentor" <${emailUser}>`,
    to: candidateEmail,
    subject: "Invitation to AI Mentor session",
    text: `You are invited to join your AI Mentor session. Open this link: ${inviteUrl}`,
    html: invitationTemplate(candidateName, candidateEmail, inviteUrl),
  });
}

function toUserDto(userRecord) {
  return {
    id: userRecord.id || String(userRecord._id),
    name: userRecord.name,
    firstName: userRecord.firstName || "",
    lastName: userRecord.lastName || "",
    email: userRecord.email,
    phonenumber: userRecord.phonenumber || "",
    stream: userRecord.stream || "",
    class: userRecord.class ?? null,
    marks: userRecord.marks || {},
    cgpa10: userRecord.cgpa10 ?? null,
    entranceExam: userRecord.entranceExam || "",
    onboardingCompleted: Boolean(userRecord.onboardingCompleted),
  };
}

export function createAuthService(deps) {
  const {
    User,
    CameraAttendance,
    CandidateInvitation,
    ConversationMessage,
    internalApiKey,
    jwtSecret,
    adminEmail,
    adminPassword,
    openai,
    openAiModel,
    transporter,
    emailUser,
    candidateAppUrl,
  } = deps;

  const register = async (payload) => {
    const firstName = String(payload?.firstName || "").trim();
    const lastName = String(payload?.lastName || "").trim();
    const email = String(payload?.email || "")
      .trim()
      .toLowerCase();
    const phonenumber = String(payload?.phonenumber || "").trim();
    const stream = String(payload?.stream || "").trim().toLowerCase();
    const studentClass = Number(payload?.class);
    const password = String(payload?.password || "");
    const role = String(payload?.role || "student").trim().toLowerCase();

    if (!firstName || !lastName || !email || !password) {
      throw createHttpError(400, "firstName, lastName, email and password are required.");
    }
    if (!email.includes("@")) throw createHttpError(400, "Please enter a valid email.");
    if (password.length < 6) throw createHttpError(400, "Password must be at least 6 characters.");
    if (phonenumber && !/^\d{10}$/.test(phonenumber)) {
      throw createHttpError(400, "Phone number must be exactly 10 digits.");
    }
    if (!Number.isFinite(studentClass) || studentClass < 1 || studentClass > 12) {
      throw createHttpError(400, "Class must be a valid number between 1 and 12.");
    }

    const existing = await User.findOne({ email });
    if (existing) throw createHttpError(409, "Account already exists for this email.");

    const fullName = `${firstName} ${lastName}`.trim();
    const userRecord = await User.create({
      name: fullName,
      firstName,
      lastName,
      email,
      phonenumber,
      stream,
      class: studentClass,
      role,
      onboardingCompleted: false,
      passwordHash: hashPassword(password),
      isVerified: true,
      otp: null,
      otpExpires: null,
    });

    // Initialize personal TaskFlow for the new user based on all existing global tasks
    await initializeTaskFlowForNewUser(userRecord._id).catch(err => {
      console.error("Error initializing TaskFlow for new user:", err);
    });

    return { user: toUserDto(userRecord) };
  };

  const login = async (payload) => {
    const email = String(payload?.email || "")
      .trim()
      .toLowerCase();
    const password = String(payload?.password || "");
    if (!email || !password) throw createHttpError(400, "Email and password are required.");

    const userRecord = await User.findOne({ email });
    if (!userRecord || !verifyPassword(password, userRecord.passwordHash)) {
      throw createHttpError(401, "Invalid email or password.");
    }

    const user = toUserDto(userRecord);
    // Use the actual role from the database, or default to "student"
    const token = jwt.sign({ sub: user.id, email: user.email, name: user.name, role: userRecord.role || "student" }, jwtSecret, {
      expiresIn: "8h",
    });
    return { token, user };
  };

  const profile = async (userId) => {
    const userRecord = await User.findById(userId).lean();
    if (!userRecord) throw createHttpError(404, "User not found.");
    return toUserDto(userRecord);
  };

  const onboarding = async (userId, payload) => {
    const stream = String(payload?.stream || "").trim();
    const studentClass = Number(payload?.class);
    const cgpa10 = payload?.cgpa10 === "" || payload?.cgpa10 == null ? null : Number(payload?.cgpa10);
    const entranceExam = String(payload?.entranceExam || "").trim();
    const marksInput = payload?.marks || {};
    const marks = {
      physics: marksInput.physics === "" || marksInput.physics == null ? null : Number(marksInput.physics),
      chemistry: marksInput.chemistry === "" || marksInput.chemistry == null ? null : Number(marksInput.chemistry),
      maths: marksInput.maths === "" || marksInput.maths == null ? null : Number(marksInput.maths),
      biology: marksInput.biology === "" || marksInput.biology == null ? null : Number(marksInput.biology),
    };

    if (!stream) throw createHttpError(400, "stream is required.");
    if (!Number.isFinite(studentClass) || studentClass < 1 || studentClass > 12) {
      throw createHttpError(400, "class must be between 1 and 12.");
    }
    if (cgpa10 != null && (!Number.isFinite(cgpa10) || cgpa10 < 0 || cgpa10 > 10)) {
      throw createHttpError(400, "cgpa10 must be between 0 and 10.");
    }
    for (const [subject, mark] of Object.entries(marks)) {
      if (mark == null) continue;
      if (!Number.isFinite(mark) || mark < 0 || mark > 100) {
        throw createHttpError(400, `${subject} mark must be between 0 and 100.`);
      }
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          stream,
          class: studentClass,
          marks,
          cgpa10,
          entranceExam,
          onboardingCompleted: true,
        },
      },
      { new: true },
    ).lean();
    if (!updated) throw createHttpError(404, "User not found.");

    return {
      id: String(updated._id),
      stream: updated.stream || "",
      class: updated.class ?? null,
      marks: updated.marks || {},
      cgpa10: updated.cgpa10 ?? null,
      entranceExam: updated.entranceExam || "",
      onboardingCompleted: Boolean(updated.onboardingCompleted),
    };
  };

  const internalCandidateProfile = async (key, userId) => {
    if (!internalApiKey || String(key || "") !== internalApiKey) {
      throw createHttpError(401, "Unauthorized internal request.");
    }
    const safeUserId = String(userId || "").trim();
    if (!safeUserId) throw createHttpError(400, "userId is required.");

    const userRecord = await User.findById(safeUserId).lean();
    if (!userRecord) throw createHttpError(404, "User not found.");

    return {
      id: String(userRecord._id),
      name: userRecord.name || "",
      firstName: userRecord.firstName || "",
      email: userRecord.email || "",
      stream: userRecord.stream || "",
      class: userRecord.class ?? null,
      marks: {
        physics: userRecord?.marks?.physics ?? null,
        chemistry: userRecord?.marks?.chemistry ?? null,
        maths: userRecord?.marks?.maths ?? null,
        biology: userRecord?.marks?.biology ?? null,
      },
      cgpa10: userRecord.cgpa10 ?? null,
      entranceExam: userRecord.entranceExam || "",
      onboardingCompleted: Boolean(userRecord.onboardingCompleted),
    };
  };

  const adminLogin = async (payload) => {
    const email = String(payload?.email || "")
      .trim()
      .toLowerCase();
    const password = String(payload?.password || "");
    if (!email || !password) throw createHttpError(400, "Email and password are required.");
    if (email !== adminEmail || password !== adminPassword) {
      throw createHttpError(401, "Invalid admin credentials.");
    }

    const token = jwt.sign({ sub: `admin:${email}`, email, name: "Admin", role: "admin" }, jwtSecret, {
      expiresIn: "8h",
    });
    return { token, admin: { email, role: "admin" } };
  };

  const createInvitation = async (payload, invitedBy) => {
    const candidateName = String(payload?.name || "").trim();
    const candidateEmail = String(payload?.email || "")
      .trim()
      .toLowerCase();
    if (!candidateName) throw createHttpError(400, "Candidate name is required.");
    if (!candidateEmail) throw createHttpError(400, "Candidate email is required.");
    if (!candidateEmail.includes("@")) throw createHttpError(400, "Candidate email is invalid.");

    const inviteUrl = String(candidateAppUrl || "").trim() || "http://localhost:5173";
    await User.updateOne(
      { email: candidateEmail },
      {
        $set: { email: candidateEmail, name: candidateName },
        $setOnInsert: { isVerified: false, otp: null, otpExpires: null },
      },
      { upsert: true },
    );
    await CandidateInvitation.updateOne(
      { email: candidateEmail },
      {
        $set: {
          candidateName,
          email: candidateEmail,
          invitedBy: invitedBy || "admin",
          lastInvitedAt: new Date(),
        },
        $setOnInsert: { firstInvitedAt: new Date() },
        $inc: { inviteCount: 1 },
      },
      { upsert: true },
    );
    await sendInvitationMail(transporter, emailUser, candidateName, candidateEmail, inviteUrl);
    return { message: `Invitation sent to ${candidateEmail}.` };
  };

  const invitedCandidates = async () => {
    const inviteRecords = await CandidateInvitation.find({}).sort({ lastInvitedAt: -1 }).lean();
    const attendanceRecords = await CameraAttendance.find({}).lean();
    const userRecords = await User.find({}, { email: 1, name: 1 }).lean();

    const attendanceByEmail = new Map(attendanceRecords.filter((r) => r?.email).map((r) => [String(r.email).toLowerCase(), r]));
    const inviteByEmail = new Map(inviteRecords.filter((r) => r?.email).map((r) => [String(r.email).toLowerCase(), r]));
    const userByEmail = new Map(userRecords.filter((r) => r?.email).map((r) => [String(r.email).toLowerCase(), String(r.name || "").trim()]));
    const allEmails = new Set([...inviteByEmail.keys(), ...attendanceByEmail.keys()]);

    const records = Array.from(allEmails).map((email) => {
      const row = inviteByEmail.get(email) || null;
      const attendance = attendanceByEmail.get(email) || null;
      const insights = attendance ? buildAttendanceInsights(attendance) : null;
      const candidateName = String(row?.candidateName || "").trim() || String(userByEmail.get(email) || "").trim();
      return {
        candidateName,
        email,
        invitedBy: row?.invitedBy || "system:auto",
        inviteCount: Number(row?.inviteCount || 0),
        firstInvitedAt: row?.firstInvitedAt || row?.createdAt || attendance?.createdAt || null,
        lastInvitedAt: row?.lastInvitedAt || row?.updatedAt || attendance?.updatedAt || null,
        attended: Boolean(row?.trainingCompleted),
        trainingCompleted: Boolean(row?.trainingCompleted),
        completedAt: row?.completedAt || null,
        attendanceStatus: attendance?.status || "not-started",
        lastAttendedAt: attendance?.updatedAt || null,
        attendanceNote: attendance?.note || "",
        attendanceUpdatedAt: attendance?.updatedAt || null,
        insights: insights
          ? {
            currentlyDetected: Boolean(insights.currentlyDetected),
            outSince: insights.outSince || null,
            lastSeenAt: insights.lastSeenAt || null,
            presentMinutes: Number(insights.presentMinutes || 0),
            awayMinutes: Number(insights.awayMinutes || 0),
            totalTrainingMinutes: Number(insights.totalTrainingMinutes || 0),
          }
          : null,
      };
    });
    records.sort((a, b) => new Date(b.lastInvitedAt || 0).getTime() - new Date(a.lastInvitedAt || 0).getTime());

    const totals = {
      invited: records.length,
      attended: records.filter((row) => row.trainingCompleted).length,
    };
    totals.pending = Math.max(0, totals.invited - totals.attended);
    return { totals, records };
  };

  const aiRespond = (payload) => {
    const message = String(payload?.message || "").trim();
    if (!message) throw createHttpError(400, "message is required.");
    return {
      reply: `Welcome to AI Mentor. I heard: "${message}". In the next step we can wire GPT-4o mini streaming plus Deepgram STT/TTS and Beyond Presence avatar playback.`,
    };
  };

  const evaluateEndIntent = async (text) => {
    if (!openai) throw createHttpError(503, "AI service unavailable.");
    const completion = await openai.chat.completions.create({
      model: openAiModel || "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Classify whether the user's message clearly expresses intent to END/STOP/CLOSE the current training now. Return strict JSON only: {\"endIntent\":true|false}.",
        },
        { role: "user", content: text },
      ],
    });

    const raw = String(completion.choices?.[0]?.message?.content || "").trim();
    try {
      return Boolean(JSON.parse(raw)?.endIntent);
    } catch {
      return /"endIntent"\s*:\s*true/i.test(raw);
    }
  };

  const aiEndIntent = async (payload) => {
    const text = String(payload?.text || "").trim();
    if (!text) throw createHttpError(400, "text is required.");
    return { endIntent: await evaluateEndIntent(text) };
  };

  const evaluateAssessmentStartIntent = async (text) => {
    if (!openai) throw createHttpError(503, "AI service unavailable.");
    const completion = await openai.chat.completions.create({
      model: openAiModel || "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            'Classify whether the user is asking to START/BEGIN/TAKE an assessment/quiz/test now. Return strict JSON only: {"startAssessment":true|false}.',
        },
        { role: "user", content: text },
      ],
    });

    const raw = String(completion.choices?.[0]?.message?.content || "").trim();
    try {
      return Boolean(JSON.parse(raw)?.startAssessment);
    } catch {
      return /"startAssessment"\s*:\s*true/i.test(raw);
    }
  };

  const internalTrainingEndIntent = async (key, payload) => {
    if (!internalApiKey || String(key || "") !== internalApiKey) {
      throw createHttpError(401, "Unauthorized internal request.");
    }
    const text = String(payload?.text || "").trim();
    if (!text) throw createHttpError(400, "text is required.");
    return { ok: true, endIntent: await evaluateEndIntent(text) };
  };

  const internalAssessmentStartIntent = async (key, payload) => {
    if (!internalApiKey || String(key || "") !== internalApiKey) {
      throw createHttpError(401, "Unauthorized internal request.");
    }
    const text = String(payload?.text || "").trim();
    if (!text) throw createHttpError(400, "text is required.");
    return { ok: true, startAssessment: await evaluateAssessmentStartIntent(text) };
  };

  const normalizeGeneratedQuestions = (raw) => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item, idx) => {
        const options = Array.isArray(item?.options)
          ? item.options.map((opt) => String(opt || "").trim()).filter(Boolean)
          : [];
        const question = String(item?.question || "").trim();
        if (!question || options.length < 2) return null;
        const correctAnswer = String(item?.correctAnswer || "").trim();
        return {
          id: String(item?.id || `q${idx + 1}`),
          question,
          options: options.slice(0, 4),
          correctAnswer: correctAnswer || options[0],
        };
      })
      .filter(Boolean)
      .slice(0, 5);
  };

  const generateAssessmentFromConversation = async (key, payload) => {
    if (!internalApiKey || String(key || "") !== internalApiKey) {
      throw createHttpError(401, "Unauthorized internal request.");
    }
    if (!openai) throw createHttpError(503, "AI service unavailable.");
    const userId = String(payload?.userId || "").trim();
    if (!userId) throw createHttpError(400, "userId is required.");

    const recentMessages = await ConversationMessage.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
    const ordered = [...recentMessages].reverse();
    const transcript = ordered
      .map((m) => {
        const role = m?.role === "assistant" ? "Mentor" : "Candidate";
        return `${role}: ${String(m?.text || "").trim()}`;
      })
      .filter((line) => line.length > 0)
      .join("\n");

    if (!transcript) {
      return { ok: true, title: "Quick Assessment", questions: [] };
    }

    const completion = await openai.chat.completions.create({
      model: openAiModel || "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            'Create 3 to 5 MCQ questions based ONLY on the mentoring conversation. Return strict JSON: {"title":"...","questions":[{"id":"q1","question":"...","options":["...","...","...","..."],"correctAnswer":"..."}]}',
        },
        {
          role: "user",
          content: `Conversation transcript:\n${transcript}`,
        },
      ],
    });

    const raw = String(completion.choices?.[0]?.message?.content || "").trim();
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    const questions = normalizeGeneratedQuestions(parsed?.questions);
    return {
      ok: true,
      title: String(parsed?.title || "Conversation-based Assessment"),
      questions,
    };
  };

  return {
    register,
    login,
    profile,
    onboarding,
    internalCandidateProfile,
    adminLogin,
    createInvitation,
    invitedCandidates,
    aiRespond,
    aiEndIntent,
    internalTrainingEndIntent,
    internalAssessmentStartIntent,
    generateAssessmentFromConversation,
  };
}
