# AI Mentor Authentication & API Documentation

This Node.js backend provides a robust user authentication system using JWT tokens and securely hashed passwords (Bcrypt).

## Getting Started
To run the server locally:
1. Clone the repository.
2. Run `npm install` to install dependencies.
3. Ensure your `.env` contains the following:
   ```env
   PORT=5000
   MONGO_URI=mongodb://localhost:27017/ai_mentor
   JWT_SECRET=your_super_secure_jwt_secret_key_here
   ```
4. Start the server using `npm run dev` (for development with nodemon) or `npm start`.

---

## Authentication APIs

All Auth APIs are mounted under `/api/auth`.

### 1. Register User
Creates a new user account with a securely hashed password. The `stream` field strictly accepts `"jee"` or `"neet"`.

* **URL:** `/api/auth/register`
* **Method:** `POST`
* **Content-Type:** `application/json`
* **Body Payload:**
  ```json
  {
      "firstName": "John",
      "lastName": "Doe",
      "email": "john.doe@example.com",
      "phonenumber": "9876543210",
      "stream": "jee",
      "class": 12,
      "password": "mySecurePassword123"
  }
  ```
* **Success Response (201 Created):**
  ```json
  {
      "success": true,
      "message": "User registered successfully",
      "data": { ...user_object... }
  }
  ```

### 2. Login User
Authenticates a user by their email and password. Returns a secure JWT token required for accessing protected routes.

* **URL:** `/api/auth/login`
* **Method:** `POST`
* **Content-Type:** `application/json`
* **Body Payload:**
  ```json
  {
      "email": "john.doe@example.com",
      "password": "mySecurePassword123"
  }
  ```
* **Success Response (200 OK):**
  ```json
  {
      "success": true,
      "data": {
          "user": { ...user_object... },
          "token": "eyJhbG...<token_string>"
      }
  }
  ```

### 3. Get User Profile (Protected)
Fetches the currently logged-in user's securely stored profile details.

* **URL:** `/api/auth/profile`
* **Method:** `GET`
* **Headers Required:**
  * `Authorization: Bearer <your_jwt_token>`
* **Success Response (200 OK):**
  ```json
  {
      "success": true,
      "data": { ...user_object... }
  }
  ```

---

## Application Data APIs

These APIs handle the core data operations of the application and are mounted under `/api/data`. **All data routes require a valid JWT Token** in the `Authorization` header.

### 1. Store Data (Protected)
* **URL:** `/api/data/store`
* **Method:** `POST`
* **Authorization:** `Bearer <token>`
* **Description:** Stores data securely linked to the authenticated user ID.

### 2. Get Data (Protected)
* **URL:** `/api/data/`
* **Method:** `GET`
* **Authorization:** `Bearer <token>`
* **Description:** Retrieves all data entries exclusively belonging to the authenticated user. Responses include a `count` of items alongside the `data` array.
