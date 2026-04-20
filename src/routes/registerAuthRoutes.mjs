import jwt from "jsonwebtoken";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { buildAttendanceInsights } from "../services/attendanceInsights.mjs";

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

function buildDemoAiReply(userText) {
  const cleaned = userText.trim();
  return `Welcome to AI Mentor. I heard: "${cleaned}". In the next step we can wire GPT-4o mini streaming plus Deepgram STT/TTS and Beyond Presence avatar playback.`;
}

export function registerAuthRoutes(app, deps) {
  const {
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
    emailUser,
    candidateAppUrl,
  } = deps;

  app.post("/auth/register", async (req, res) => {
    try {
      const firstName = String(req.body?.firstName || "").trim();
      const lastName = String(req.body?.lastName || "").trim();
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const phonenumber = String(req.body?.phonenumber || "").trim();
      const stream = String(req.body?.stream || "").trim().toLowerCase();
      const studentClass = Number(req.body?.class);
      const password = String(req.body?.password || "");

      if (!firstName || !lastName || !email || !password) {
        return res.status(400).json({ success: false, message: "firstName, lastName, email and password are required." });
      }
      if (!email.includes("@")) {
        return res.status(400).json({ success: false, message: "Please enter a valid email." });
      }
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }
      if (phonenumber && !/^\d{10}$/.test(phonenumber)) {
        return res.status(400).json({ success: false, message: "Phone number must be exactly 10 digits." });
      }
      if (!Number.isFinite(studentClass) || studentClass < 1 || studentClass > 12) {
        return res.status(400).json({ success: false, message: "Class must be a valid number between 1 and 12." });
      }

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ success: false, message: "Account already exists for this email." });
      }

      const fullName = `${firstName} ${lastName}`.trim();
      const userRecord = await User.create({
        name: fullName,
        firstName,
        lastName,
        email,
        phonenumber,
        stream,
        class: studentClass,
        onboardingCompleted: false,
        passwordHash: hashPassword(password),
        isVerified: true,
        otp: null,
        otpExpires: null,
      });

      return res.status(201).json({
        success: true,
        message: "Registration successful.",
        data: {
          user: {
            id: userRecord.id,
            name: userRecord.name,
            firstName: userRecord.firstName,
            lastName: userRecord.lastName,
            email: userRecord.email,
            phonenumber: userRecord.phonenumber,
            stream: userRecord.stream,
            class: userRecord.class,
            marks: userRecord.marks || {},
            cgpa10: userRecord.cgpa10 ?? null,
            entranceExam: userRecord.entranceExam || "",
            onboardingCompleted: Boolean(userRecord.onboardingCompleted),
          },
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Failed to register user." });
    }
  });

  app.post("/auth/login", async (req, res) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const password = String(req.body?.password || "");
      if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required." });
      }

      const userRecord = await User.findOne({ email });
      if (!userRecord || !verifyPassword(password, userRecord.passwordHash)) {
        return res.status(401).json({ success: false, message: "Invalid email or password." });
      }

      const user = {
        id: userRecord.id,
        name: userRecord.name,
        firstName: userRecord.firstName,
        lastName: userRecord.lastName,
        email: userRecord.email,
        phonenumber: userRecord.phonenumber,
        stream: userRecord.stream,
        class: userRecord.class,
        marks: userRecord.marks || {},
        cgpa10: userRecord.cgpa10 ?? null,
        entranceExam: userRecord.entranceExam || "",
        onboardingCompleted: Boolean(userRecord.onboardingCompleted),
      };
      const token = jwt.sign({ sub: user.id, email: user.email, name: user.name, role: "candidate" }, jwtSecret, {
        expiresIn: "8h",
      });

      return res.json({ success: true, data: { token, user } });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Login failed." });
    }
  });

  app.get("/auth/profile", verifyHttpAuth, async (req, res) => {
    try {
      const userRecord = await User.findById(req.user.sub).lean();
      if (!userRecord) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      return res.json({
        success: true,
        data: {
          id: String(userRecord._id),
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
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Failed to fetch profile." });
    }
  });

  app.post("/data/onboarding", verifyHttpAuth, async (req, res) => {
    try {
      const stream = String(req.body?.stream || "").trim();
      const studentClass = Number(req.body?.class);
      const cgpa10 = req.body?.cgpa10 === "" || req.body?.cgpa10 == null ? null : Number(req.body?.cgpa10);
      const entranceExam = String(req.body?.entranceExam || "").trim();
      const marksInput = req.body?.marks || {};
      const marks = {
        physics: marksInput.physics === "" || marksInput.physics == null ? null : Number(marksInput.physics),
        chemistry: marksInput.chemistry === "" || marksInput.chemistry == null ? null : Number(marksInput.chemistry),
        maths: marksInput.maths === "" || marksInput.maths == null ? null : Number(marksInput.maths),
        biology: marksInput.biology === "" || marksInput.biology == null ? null : Number(marksInput.biology),
      };

      if (!stream) {
        return res.status(400).json({ success: false, message: "stream is required." });
      }
      if (!Number.isFinite(studentClass) || studentClass < 1 || studentClass > 12) {
        return res.status(400).json({ success: false, message: "class must be between 1 and 12." });
      }
      if (cgpa10 != null && (!Number.isFinite(cgpa10) || cgpa10 < 0 || cgpa10 > 10)) {
        return res.status(400).json({ success: false, message: "cgpa10 must be between 0 and 10." });
      }
      for (const [subject, mark] of Object.entries(marks)) {
        if (mark == null) continue;
        if (!Number.isFinite(mark) || mark < 0 || mark > 100) {
          return res.status(400).json({ success: false, message: `${subject} mark must be between 0 and 100.` });
        }
      }

      const updated = await User.findByIdAndUpdate(
        req.user.sub,
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
      if (!updated) {
        return res.status(404).json({ success: false, message: "User not found." });
      }

      return res.json({
        success: true,
        message: "Onboarding saved.",
        data: {
          id: String(updated._id),
          stream: updated.stream || "",
          class: updated.class ?? null,
          marks: updated.marks || {},
          cgpa10: updated.cgpa10 ?? null,
          entranceExam: updated.entranceExam || "",
          onboardingCompleted: Boolean(updated.onboardingCompleted),
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Failed to save onboarding." });
    }
  });

  app.get("/data/profile", verifyHttpAuth, async (req, res) => {
    try {
      const userRecord = await User.findById(req.user.sub).lean();
      if (!userRecord) {
        return res.status(404).json({ success: false, message: "User not found." });
      }
      return res.json({
        success: true,
        data: {
          id: String(userRecord._id),
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
        },
      });
    } catch (error) {
      return res.status(500).json({ success: false, message: error.message || "Failed to fetch profile data." });
    }
  });

  app.get("/internal/candidates/:userId/profile", async (req, res) => {
    try {
      const key = String(req.headers["x-internal-key"] || "");
      if (!internalApiKey || key !== internalApiKey) {
        return res.status(401).json({ message: "Unauthorized internal request." });
      }
      const userId = String(req.params?.userId || "").trim();
      if (!userId) {
        return res.status(400).json({ message: "userId is required." });
      }
      const userRecord = await User.findById(userId).lean();
      if (!userRecord) {
        return res.status(404).json({ message: "User not found." });
      }
      return res.json({
        ok: true,
        profile: {
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
        },
      });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to fetch internal profile." });
    }
  });

  app.post("/admin/login", async (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }
    if (email !== adminEmail || password !== adminPassword) {
      return res.status(401).json({ message: "Invalid admin credentials." });
    }

    const token = jwt.sign(
      { sub: `admin:${email}`, email, name: "Admin", role: "admin" },
      jwtSecret,
      { expiresIn: "8h" },
    );
    return res.json({
      token,
      admin: { email, role: "admin" },
    });
  });

  app.post("/admin/invitations", verifyAdminAuth, async (req, res) => {
    const candidateName = String(req.body?.name || "").trim();
    const candidateEmail = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!candidateName) {
      return res.status(400).json({ message: "Candidate name is required." });
    }
    if (!candidateEmail) {
      return res.status(400).json({ message: "Candidate email is required." });
    }
    if (!candidateEmail.includes("@")) {
      return res.status(400).json({ message: "Candidate email is invalid." });
    }

    const inviteUrl = String(candidateAppUrl || "").trim() || "http://localhost:5173";
    try {
      await User.updateOne(
        { email: candidateEmail },
        {
          $set: {
            email: candidateEmail,
            name: candidateName,
          },
          $setOnInsert: {
            isVerified: false,
            otp: null,
            otpExpires: null,
          },
        },
        { upsert: true },
      );
      await CandidateInvitation.updateOne(
        { email: candidateEmail },
        {
          $set: {
            candidateName,
            email: candidateEmail,
            invitedBy: req.user?.email || "admin",
            lastInvitedAt: new Date(),
          },
          $setOnInsert: {
            firstInvitedAt: new Date(),
          },
          $inc: {
            inviteCount: 1,
          },
        },
        { upsert: true },
      );
      await sendInvitationMail(transporter, emailUser, candidateName, candidateEmail, inviteUrl);
      return res.json({ message: `Invitation sent to ${candidateEmail}.` });
    } catch (error) {
      return res.status(500).json({ message: "Failed to send invitation email.", error: error.message });
    }
  });

  app.get("/admin/candidates/invited", verifyAdminAuth, async (req, res) => {
    try {
      const inviteRecords = await CandidateInvitation.find({}).sort({ lastInvitedAt: -1 }).lean();
      const attendanceRecords = await CameraAttendance.find({}).lean();
      const userRecords = await User.find({}, { email: 1, name: 1 }).lean();

      const attendanceByEmail = new Map(
        attendanceRecords
          .filter((row) => row?.email)
          .map((row) => [String(row.email).toLowerCase(), row]),
      );
      const inviteByEmail = new Map(
        inviteRecords
          .filter((row) => row?.email)
          .map((row) => [String(row.email).toLowerCase(), row]),
      );
      const userByEmail = new Map(
        userRecords
          .filter((row) => row?.email)
          .map((row) => [String(row.email).toLowerCase(), String(row.name || "").trim()]),
      );

      const allEmails = new Set([
        ...inviteByEmail.keys(),
        ...attendanceByEmail.keys(),
      ]);

      const records = Array.from(allEmails).map((email) => {
        const row = inviteByEmail.get(email) || null;
        const attendance = attendanceByEmail.get(email) || null;
        const insights = attendance ? buildAttendanceInsights(attendance) : null;
        const candidateName =
          String(row?.candidateName || "").trim() ||
          String(userByEmail.get(email) || "").trim();
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

      return res.json({ totals, records });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to load invited candidates." });
    }
  });

  app.post("/ai/respond", (req, res) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ message: "message is required." });
    }
    return res.json({ reply: buildDemoAiReply(message) });
  });

  app.post("/ai/end-intent", verifyHttpAuth, async (req, res) => {
    try {
      const text = String(req.body?.text || "").trim();
      if (!text) {
        return res.status(400).json({ message: "text is required." });
      }
      if (!openai) {
        return res.status(503).json({ message: "AI service unavailable." });
      }

      const completion = await openai.chat.completions.create({
        model: openAiModel || "gpt-4o-mini",
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Classify whether the user's message clearly expresses intent to END/STOP/CLOSE the current training call now. Return strict JSON only: {\"endIntent\":true|false}. Use true only for explicit or strongly implied end intent in this message.",
          },
          {
            role: "user",
            content: text,
          },
        ],
      });

      const raw = String(completion.choices?.[0]?.message?.content || "").trim();
      let endIntent = false;
      try {
        const parsed = JSON.parse(raw);
        endIntent = Boolean(parsed?.endIntent);
      } catch {
        // Safe fallback for non-JSON model output
        endIntent = /"endIntent"\s*:\s*true/i.test(raw);
      }
      return res.json({ endIntent });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to classify end intent." });
    }
  });

  app.post("/internal/training/end-intent", async (req, res) => {
    try {
      const key = String(req.headers["x-internal-key"] || "");
      if (!internalApiKey || key !== internalApiKey) {
        return res.status(401).json({ message: "Unauthorized internal request." });
      }

      const text = String(req.body?.text || "").trim();
      if (!text) {
        return res.status(400).json({ message: "text is required." });
      }
      if (!openai) {
        return res.status(503).json({ message: "AI service unavailable." });
      }

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
      let endIntent = false;
      try {
        endIntent = Boolean(JSON.parse(raw)?.endIntent);
      } catch {
        endIntent = /"endIntent"\s*:\s*true/i.test(raw);
      }

      return res.json({ ok: true, endIntent });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Failed to evaluate end intent." });
    }
  });
}
