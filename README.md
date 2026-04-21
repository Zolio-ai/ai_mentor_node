<div align="center">
  <img src="https://private-user-images.githubusercontent.com/74038190/240815616-7b282ec6-fcc3-4600-90a7-2c3140549f58.gif?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NjI5Nzg4NjIsIm5iZiI6MTc2Mjk3ODU2MiwicGF0aCI6Ii83NDAzODE5MC8yNDA4MTU2MTYtN2IyODJlYzYtZmNjMy00NjAwLTkwYTctMmMzMTQwNTQ5ZjU4LmdpZj9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTExMTIlMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUxMTEyVDIwMTYwMlomWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTdiNzU5MTM5MTcwNDQ5NzMwM2U2NzQ4MzU3Y2UxZWVjNTc0MWMzZGVmMzJlZmFmMzJmMDI2OGU0MzVlZWY2YjQmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.Ux_-hRldZYY4D118zV0I1d2JLkWa8Q2h-QAH64-ErGQ" alt="AI Mentor Animation" width="500"/>
</div>

# AI Mentor Node API Documentation

Welcome to the **AI Mentor** backend documentation. This system provides a robust platform for AI-driven preparation, session management with LiveKit avatars, and study material parsing.

---

## Quick Reference

### 1. Auth & Profiles
- [`POST /auth/register`](#auth-register) - User registration
- [`POST /auth/login`](#auth-login) - User login
- [`GET /auth/profile`](#auth-profile) - Get user profile
- [`POST /data/onboarding`](#data-onboarding) - Submit onboarding data
- [`GET /data/profile`](#data-profile) - Get detailed profile data
- [`GET /internal/candidates/:userId/profile`](#internal-profile) - Internal candidate lookup
- [`POST /admin/login`](#admin-login) - Admin login
- [`POST /admin/invitations`](#admin-invitations) - Send session invitations
- [`GET /admin/candidates/invited`](#admin-candidates) - List invited candidates

### 2. AI & Interactive
- [`POST /ai/respond`](#ai-respond) - Basic AI response test
- [`POST /ai/end-intent`](#ai-end-intent) - Classify intent to end session
- [`POST /avatar/bey/session`](#avatar-session) - Create LiveKit avatar session
- [`POST /avatar/bey/end`](#avatar-end) - End avatar session
- [`GET /avatar/bey/room/:roomName/participants`](#avatar-participants) - List room participants

### 3. Attendance & Progress
- [`POST /attendance/camera`](#attendance-camera) - Log camera attendance status
- [`GET /attendance/camera/latest`](#attendance-latest) - Admin view of latest attendance
- [`POST /attendance/completion`](#attendance-completion) - Mark training as completed
- [`POST /internal/training/completion`](#internal-completion) - Internal completion hook

### 4. Study Material Parsing
- [`POST /parse-study-plan`](#parse-study-plan) - Parse PDF study plan
- [`POST /parse-study-material`](#parse-study-material) - Parse PDF study material
- [`GET /study-plans`](#get-study-plans) - Retrieve all study plans
- [`GET /study-materials`](#get-study-materials) - Retrieve all study materials
- [`GET /study-materials/:id/download`](#study-download) - Download material PDF

### 5. WebSocket (Real-time)
- [`WS://localhost:4000`](#websocket-interface) - Real-time AI chat & Voice preparation

---

## 1. Auth & Profiles

### <a id="auth-register"></a> User Registration
**URL:** `/auth/register`  
**Method:** `POST`

Creates a new student account.

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "password": "securepassword",
  "phonenumber": "1234567890",
  "stream": "Science",
  "class": 12
}
```

**Successful Response:**
```json
{
  "success": true,
  "message": "Registration successful.",
  "data": {
    "user": {
      "id": "643d...",
      "name": "John Doe",
      "email": "john.doe@example.com",
      "onboardingCompleted": false
    }
  }
}
```

---

### <a id="auth-login"></a> User Login
**URL:** `/auth/login`  
**Method:** `POST`

Returns a JWT token for session authentication.

**Request Body:**
```json
{
  "email": "john.doe@example.com",
  "password": "securepassword"
}
```

**Successful Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbG...",
    "user": {
      "id": "643d...",
      "name": "John Doe",
      "email": "john.doe@example.com",
      "onboardingCompleted": false
    }
  }
}
```

---

### <a id="auth-profile"></a> Get Profile
**URL:** `/auth/profile`  
**Method:** `GET`  
**Auth:** Bearer Token

Returns the basic profile of the authenticated user.

**Successful Response:**
```json
{
  "success": true,
  "data": {
    "id": "643d...",
    "name": "John Doe",
    "email": "john.doe@example.com",
    "onboardingCompleted": true
  }
}
```

---

### <a id="data-onboarding"></a> Onboarding Data
**URL:** `/data/onboarding`  
**Method:** `POST`  
**Auth:** Bearer Token

Updates student academic details and marks onboarding as completed.

**Request Body:**
```json
{
  "stream": "Maths",
  "class": 12,
  "cgpa10": 9.5,
  "entranceExam": "JEE",
  "marks": {
    "physics": 90,
    "chemistry": 85,
    "maths": 95
  }
}
```

**Successful Response:**
```json
{
  "success": true,
  "message": "Onboarding saved.",
  "data": {
    "id": "643d...",
    "onboardingCompleted": true
  }
}
```

---

### <a id="data-profile"></a> Detailed Profile Data
**URL:** `/data/profile`  
**Method:** `GET`  
**Auth:** Bearer Token

Fetches full user data including academic scores and onboarding status.

**Successful Response:**
```json
{
  "success": true,
  "data": {
    "id": "643d...",
    "name": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "stream": "maths",
    "class": 12,
    "marks": {
      "physics": 90,
      "chemistry": 85,
      "maths": 95,
      "biology": null
    },
    "cgpa10": 9.5,
    "onboardingCompleted": true
  }
}
```

---

### <a id="internal-profile"></a> Internal Candidate Lookup
**URL:** `/internal/candidates/:userId/profile`  
**Method:** `GET`  
**Headers:** `x-internal-key: <INTERNAL_API_KEY>`

Secure internal endpoint for other services to fetch candidate details.

**Successful Response:**
```json
{
  "ok": true,
  "profile": {
    "id": "643d...",
    "name": "John Doe",
    "email": "john.doe@example.com",
    "class": 12
  }
}
```

---

## 2. AI & Interactive

### <a id="admin-login"></a> Admin Login
**URL:** `/admin/login`  
**Method:** `POST`

**Request Body:**
```json
{
  "email": "admin@example.com",
  "password": "adminpassword"
}
```

**Successful Response:**
```json
{
  "token": "eyJhbG...",
  "admin": {
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

---

### <a id="admin-invitations"></a> Send Session Invitations
**URL:** `/admin/invitations`  
**Method:** `POST`  
**Auth:** Admin Token

**Request Body:**
```json
{
  "name": "Alice Smith",
  "email": "alice@example.com"
}
```

**Successful Response:**
```json
{
  "message": "Invitation sent to alice@example.com."
}
```

---

### <a id="admin-candidates"></a> List Invited Candidates
**URL:** `/admin/candidates/invited`  
**Method:** `GET`  
**Auth:** Admin Token

**Successful Response:**
```json
{
  "totals": {
    "invited": 25,
    "attended": 10,
    "pending": 15
  },
  "records": [
    {
      "candidateName": "Alice Smith",
      "email": "alice@example.com",
      "invitedBy": "admin",
      "attended": true,
      "attendanceStatus": "present",
      "insights": {
        "currentlyDetected": true,
        "presentMinutes": 45
      }
    }
  ]
}
```

---

### <a id="ai-respond"></a> AI Response Test
**URL:** `/ai/respond`  
**Method:** `POST`

**Request Body:**
```json
{
  "message": "Hello AI"
}
```

**Successful Response:**
```json
{
  "reply": "Welcome to AI Mentor. I heard: \"Hello AI\"..."
}
```

---

### <a id="ai-end-intent"></a> Classify End Intent
**URL:** `/ai/end-intent`  
**Method:** `POST`

**Request Body:**
```json
{
  "text": "I want to stop now"
}
```

**Successful Response:**
```json
{
  "endIntent": true
}
```

---

### <a id="avatar-session"></a> Create Avatar Session
**URL:** `/avatar/bey/session`  
**Method:** `POST`  
**Auth:** Bearer Token

Initializes a LiveKit room and dispatches an AI agent.

**Successful Response:**
```json
{
  "roomName": "mentor-643d...",
  "livekitUrl": "wss://host.livekit.cloud",
  "participantToken": "eyJhbG...",
  "dispatchAgent": "ai-mentor-bey-agent",
  "dispatchId": "dispatch_..."
}
```

---

### <a id="avatar-end"></a> End Avatar Session
**URL:** `/avatar/bey/end`  
**Method:** `POST`  
**Auth:** Bearer Token

**Successful Response:**
```json
{
  "ok": true,
  "roomName": "mentor-643d..."
}
```

---

### <a id="avatar-participants"></a> List Room Participants
**URL:** `/avatar/bey/room/:roomName/participants`  
**Method:** `GET`  
**Auth:** Bearer Token

**Successful Response:**
```json
{
  "roomName": "mentor-123",
  "count": 2,
  "participants": [
    { "identity": "user-123", "name": "John Doe", "state": "joined" },
    { "identity": "agent-xyz", "name": "AI Assistant", "state": "joined" }
  ]
}
```

---

## 3. Attendance & Progress

### <a id="attendance-camera"></a> Camera Attendance
**URL:** `/attendance/camera`  
**Method:** `POST`  
**Auth:** Bearer Token

**Request Body:**
```json
{
  "status": "present",
  "note": "Looking at screen",
  "cameraOn": true,
  "personDetected": true,
  "roomName": "mentor-123",
  "clientTs": "2024-03-24T10:00:00Z"
}
```

**Successful Response:**
```json
{ "ok": true }
```

---

### <a id="attendance-latest"></a> Admin View Latest Attendance
**URL:** `/attendance/camera/latest`  
**Method:** `GET`  
**Auth:** Admin Token

**Successful Response:**
```json
{
  "count": 1,
  "records": [
    {
      "email": "student@example.com",
      "status": "present",
      "candidateName": "John Doe",
      "insights": { "currentlyDetected": true }
    }
  ]
}
```

---

### <a id="attendance-completion"></a> Mark Completion
**URL:** `/attendance/completion`  
**Method:** `POST`  
**Auth:** Bearer Token

**Successful Response:**
```json
{
  "ok": true,
  "message": "Training marked as completed."
}
```

---

## 4. Study Material Parsing

### <a id="parse-study-plan"></a> Parse Study Plan
**URL:** `/parse-study-plan`  
**Method:** `POST`  
**Content-Type:** `multipart/form-data`

**Request Body (form-data):**
- `pdfFile`: [FILE]
- `planName`: "My 12th Grade Plan"

**Successful Response:**
```json
{
  "success": true,
  "data": {
    "_id": "643d...",
    "planName": "My 12th Grade Plan",
    "weeks": [
      { "weekNumber": 1, "title": "Introduction", "topics": ["Physics Basics"] }
    ]
  }
}
```

---

### <a id="parse-study-material"></a> Parse Study Material
**URL:** `/parse-study-material`  
**Method:** `POST`  
**Content-Type:** `multipart/form-data`

**Request Body (form-data):**
- `pdfFile`: [FILE]
- `subject`: "Physics"

**Successful Response:**
```json
{
  "success": true,
  "data": {
    "subject": "Physics",
    "fileName": "physics_vol1.pdf",
    "chapters": [
      {
        "chapterNumber": 1,
        "chapterTitle": "Kinematics",
        "topics": [{ "title": "Velocity", "content": "..." }]
      }
    ]
  }
}
```

---

### <a id="get-study-plans"></a> List Study Plans
**URL:** `/study-plans`  
**Method:** `GET`  
**Auth:** Bearer Token

**Successful Response:**
```json
{
  "success": true,
  "data": [
    { "_id": "643d...", "planName": "General Plan", "weeks": [...] }
  ]
}
```

---

### <a id="get-study-materials"></a> List Study Materials
**URL:** `/study-materials`  
**Method:** `GET`  
**Auth:** Bearer Token

**Successful Response:**
```json
{
  "success": true,
  "data": [
    { "_id": "643e...", "subject": "Physics", "fileName": "guide.pdf" }
  ]
}
```

---

### <a id="study-download"></a> Download Material PDF
**URL:** `/study-materials/:id/download`  
**Method:** `GET`  
**Auth:** Bearer Token

**Response:** Binary PDF stream.

---

## 5. WebSocket Interface

**URL:** `ws://localhost:4000`  
**Handshake:** `{ auth: { token: "JWT" } }`

### Incoming Events (Client -> Server)
- `user_message`: `{ "text": "Can you explain Newton's Laws?" }`
- `stt_audio`: `{ "audioBase64": "...", "mimeType": "audio/wav" }`
- `interrupt`: `null`

### Outgoing Events (Server -> Client)
- `ai_started`: `{ "messageId": "ai-123", "runId": "run-456" }`
- `ai_chunk`: `{ "messageId": "ai-123", "chunk": "Newton's" }`
- `ai_audio`: `{ "audioBase64": "...", "text": "Newton's", "mimeType": "audio/mpeg" }`
- `ai_finished`: `{ "messageId": "ai-123" }`

---

## Environment Configuration

```bash
MONGODB_URI=mongodb://...
JWT_SECRET=...
EMAIL_USER=...
EMAIL_PASS=...
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...
LIVEKIT_URL=https://...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

---
*© 2026 AI Mentor Node API Documentation.*
