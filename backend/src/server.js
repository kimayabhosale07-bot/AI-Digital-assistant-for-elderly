const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const apiRouter = require('./routes/api');
const { startReminderJob } = require('./jobs/reminderJob');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Main API Routing
app.use('/', apiRouter);

// Basic root route for verification and viva demonstration
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'AI Digital Personal Assistant for Elderly - Backend API is running.',
    status: 'online',
    timestamp: new Date().toISOString(),
    documentation: 'See README.md for endpoint and configuration details.'
  });
});

// 404 Route handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}. Please check the API documentation.` });
});

// Start Cron background jobs
startReminderJob();

// Start the server
app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(`🚀 Server is successfully running on port ${PORT}`);
  console.log(`📡 Local Access: http://localhost:${PORT}`);
  console.log(`===========================================================`);
});
