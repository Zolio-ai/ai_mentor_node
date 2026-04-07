require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middlewares/errorMiddleware');

// Check for required environment variables
if (!process.env.JWT_SECRET) {
    console.error('FATAL ERROR: JWT_SECRET is not defined.');
    process.exit(1);
}

// Initialize app and connect to Database
const connectDB = require('./config/db');
connectDB();

const app = express();

// Middleware
app.use(express.json()); // Allows parsing of JSON data in req.body
app.use(cors());

// Import Routes
const authRoutes = require('./routes/authRoutes');
const dataRoutes = require('./routes/dataRoutes');

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);

// Error Middleware
app.use(errorHandler);

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`AI Mentor Server is running on port ${PORT}`);
});
