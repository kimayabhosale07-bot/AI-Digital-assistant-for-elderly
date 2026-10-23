const express = require('express');
const router = express.Router();

const { registerUser, getUserProfile, getUserProfileByPhone } = require('../controllers/userController');
const { addMedicine, getMedicines, updateMedicineStatus, updateDoseStatus } = require('../controllers/medicineController');
const { addAppointment, getAppointments, updateAppointmentCompletion } = require('../controllers/appointmentController');
const { logHealthReading, getHealthLogs } = require('../controllers/healthController');
const { chatWithAssistant, transcribeAssistantAudio } = require('../controllers/assistantController');
const { confirmAssistantMedicine } = require('../controllers/assistantMedicineActions');

// User routes
router.post('/register', registerUser);
router.get('/user/by-phone/:phone', getUserProfileByPhone);
router.get('/user/:userId', getUserProfile);

// Medicine routes
router.post('/medicine', addMedicine);
router.get('/medicine/:userId', getMedicines);
router.put('/medicine/:medId/status', updateMedicineStatus);
router.post('/medicine/:medId/dose', updateDoseStatus);

// Appointment routes
router.post('/appointment', addAppointment);
router.get('/appointment/:userId', getAppointments);
router.put('/appointment/:apptId/completion', updateAppointmentCompletion);

// Health log route
router.post('/health-log', logHealthReading);
router.get('/health-log/:userId', getHealthLogs);

// Conversational companion: model key is read only on the backend.
router.post('/assistant/chat', chatWithAssistant);
router.post('/assistant/medicine/confirm', confirmAssistantMedicine);
const assistantAudioBody = express.raw({ type: 'audio/*', limit: '10mb' });
router.post('/assistant/transcribe', (req, res, next) => {
  assistantAudioBody(req, res, error => {
    if (!error) return next();
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The recording is too large. Keep voice messages under 10 MB.' });
    return res.status(400).json({ error: 'The audio recording could not be read. Please try again.' });
  });
}, transcribeAssistantAudio);

module.exports = router;
