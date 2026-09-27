const express = require('express');
const router = express.Router();

const { registerUser, getUserProfile } = require('../controllers/userController');
const { addMedicine, getMedicines, updateMedicineStatus } = require('../controllers/medicineController');
const { addAppointment, getAppointments } = require('../controllers/appointmentController');
const { logHealthReading, triggerSOS } = require('../controllers/healthController');

// User routes
router.post('/register', registerUser);
router.get('/user/:userId', getUserProfile);

// Medicine routes
router.post('/medicine', addMedicine);
router.get('/medicine/:userId', getMedicines);
router.put('/medicine/:medId/status', updateMedicineStatus);

// Appointment routes
router.post('/appointment', addAppointment);
router.get('/appointment/:userId', getAppointments);

// Health log and Emergency routes
router.post('/health-log', logHealthReading);
router.post('/emergency/:userId', triggerSOS);

module.exports = router;
