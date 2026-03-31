require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Initialize app and connect to Database
const connectDB = require('./config/db');
connectDB();

const app = express();

// Middleware
app.use(express.json()); // Allows parsing of JSON data in req.body
app.use(cors());

// Import Routes
const authRoutes = require('./routes/authRoute');
const dataRoutes = require('./routes/dataRoutes');

// Use Routes
app.use('/api/auth', authRoutes);
app.use('/api/data', dataRoutes);

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`AI Mentor Server is running on port ${PORT}`);
});
