const express = require('express');
const router = express.Router();

const { registerUser, getUserProfile, getUserProfileByPhone } = require('../controllers/userController');
const { addMedicine, getMedicines, updateMedicineStatus, updateDoseStatus } = require('../controllers/medicineController');
const { getSmsStatus, sendTestSms } = require('../controllers/smsController');
const { addAppointment, getAppointments } = require('../controllers/appointmentController');
const { logHealthReading, triggerSOS } = require('../controllers/healthController');
const {
  verifyNotificationIdentity,
  registerNotificationToken,
  removeNotificationToken,
  updateNotificationPreferences,
  sendTestNotification,
  inviteFamilyMember,
  acceptFamilyInvitation,
  listFamilyAccess,
  revokeFamilyAccess,
  getNotificationHistory,
} = require('../controllers/notificationController');

// User routes
router.post('/register', registerUser);
router.get('/user/by-phone/:phone', getUserProfileByPhone);
router.get('/user/:userId', getUserProfile);

// Medicine routes
router.post('/medicine', addMedicine);
router.get('/medicine/:userId', getMedicines);
router.put('/medicine/:medId/status', updateMedicineStatus);
router.post('/medicine/:medId/dose', updateDoseStatus);

// Explicit test SMS uses only the account holder's own phone, never SOS contacts.
router.get('/sms/status', getSmsStatus);
router.post('/sms/test', sendTestSms);

// FCM endpoints derive access only from a verified, server-mapped Firebase identity.
router.post('/notifications/access', verifyNotificationIdentity);
router.post('/notifications/token', registerNotificationToken);
router.delete('/notifications/token', removeNotificationToken);
router.put('/notifications/preferences', updateNotificationPreferences);
router.post('/notifications/test', sendTestNotification);
router.post('/notifications/family-access', inviteFamilyMember);
router.post('/notifications/family-access/accept', acceptFamilyInvitation);
router.get('/notifications/family-access/:patientId', listFamilyAccess);
router.delete('/notifications/family-access/:patientId', revokeFamilyAccess);
router.get('/notifications/history', getNotificationHistory);

// Appointment routes
router.post('/appointment', addAppointment);
router.get('/appointment/:userId', getAppointments);

// Health log and Emergency routes
router.post('/health-log', logHealthReading);
router.post('/emergency/:userId', triggerSOS);

module.exports = router;
