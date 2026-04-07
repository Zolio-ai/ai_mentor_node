# AI Mentor Backend API Documentation

This Node.js backend provides a student management system with authentication and academic data tracking. It includes features for registration, onboarding (academic marks), and profile management.

## 🚀 Getting Started

1. **Install Dependencies:**
   ```bash
   npm install
   ```
2. **Setup Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   PORT=5000
   MONGO_URI=mongodb://localhost:27017/ai_mentor
   JWT_SECRET=your_super_secure_jwt_secret
   ```
3. **Run the Server:**
   ```bash
   npm run dev   # For development (with nodemon)
   npm start     # For production
   ```

---

## 🔐 Authentication APIs (`/api/auth`)

All Auth endpoints are prefix with `/api/auth`.

### 1. Register Student
*   **URL:** `/api/auth/register`
*   **Method:** `POST`
*   **Payload:**
    ```json
    {
      "firstName": "John",
      "lastName": "Doe",
      "email": "[EMAIL_ADDRESS]",
      "phonenumber": "9876543210",
      "password": "password123"
    }
    ```

### 2. Login Student
*   **URL:** `/api/auth/login`
*   **Method:** `POST`
*   **Payload:**
    ```json
    {
      "email": "[EMAIL_ADDRESS]",
      "password": "password123"
    }
    ```
*   **Response:** Returns a `token` which must be sent as `Authorization: Bearer <token>` for protected routes.

---

## 📊 Student Data APIs (`/api/data`)

These APIs manage academic information and are **Protected** (require JWT token).

### 1. Onboarding (Save/Update Academic Data)
*   **URL:** `/api/data/onboarding`
*   **Method:** `POST`
*   **Description:** Saves or updates the student's academic profile.
*   **Payload Example:**
    ```json
    {
      "stream": "Science",
      "class": 12,
      "cgpa": 9.5,
      "marks": {
        "physics": 90,
        "chemistry": 92,
        "biology": 88,
        "maths": 95
      },
      "entrance": {
        "examtype": "JEE"
      }
    }
    ```

### 2. Get Full Profile
*   **URL:** `/api/data/profile`
*   **Method:** `GET`
*   **Description:** Returns combined Identity + Academic info.

### 3. Get Only Marks
*   **URL:** `/api/data/marks`
*   **Method:** `GET`
*   **Description:** Returns **only** the `marks` object.

---

## 🛠 Model Structure (`StudentData`)

| Field | Type | Details |
| :--- | :--- | :--- |
| `studentId` | ObjectId | Reference to `Student` model |
| `stream` | String | e.g., "Science", "Commerce" |
| `class` | Number | e.g., 10, 11, 12 |
| `cgpa` | Number | Overall CGPA/Percentage |
| `marks` | Object | Includes `physics`, `chemistry`, `biology`, `maths` |
| `entrance` | Object | `examtype` (Enum: 'JEE', 'KEAM', 'NEET') |

---

## 🛠 Tech Stack
- **Backend:** Node.js, Express.js
- **Database:** MongoDB, Mongoose
- **Authentication:** JWT (JSON Web Tokens)
