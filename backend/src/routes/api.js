const express = require('express');
const router = express.Router();

const { registerUser, getUserProfile, getUserProfileByPhone } = require('../controllers/userController');
const { addMedicine, getMedicines, updateMedicineStatus, updateDoseStatus } = require('../controllers/medicineController');
const { addAppointment, getAppointments } = require('../controllers/appointmentController');
const { logHealthReading } = require('../controllers/healthController');

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

// Health log route
router.post('/health-log', logHealthReading);

module.exports = router;
