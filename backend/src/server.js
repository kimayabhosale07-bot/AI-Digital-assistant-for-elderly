const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const apiRouter = require('./routes/api');
const { startReminderJob } = require('./jobs/reminderJob');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'null', // allows file:// opened pages during dev
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
}));
app.use(morgan('dev'));
app.use(express.json());

// Basic root route for verification and viva demonstration
// NOTE: Must be defined BEFORE apiRouter mount to avoid being shadowed
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'AI Digital Personal Assistant for Elderly - Backend API is running.',
    status: 'online',
    timestamp: new Date().toISOString(),
    documentation: 'See README.md for endpoint and configuration details.'
  });
});

// Main API Routing (support both /api/* and /*)
app.use('/api', apiRouter);
app.use('/', apiRouter);

// 404 Route handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}. Please check the API documentation.` });
});

// Start medicine schedule maintenance jobs
startReminderJob();

// Start the server
app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 Server is successfully running on port ${PORT}`);
  console.log(`📡 Local Access: http://localhost:${PORT}`);
  console.log(`===========================================================`);
});
