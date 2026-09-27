const twilio = require('twilio');
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;

// Only initialize if variables are present and not standard placeholders
const isConfigured = 
  accountSid && 
  authToken && 
  fromPhone && 
  !accountSid.includes('your-') && 
  !authToken.includes('your-') && 
  !fromPhone.includes('your-');

if (isConfigured) {
  try {
    twilioClient = twilio(accountSid, authToken);
    console.log('📞 Twilio SMS Client initialized successfully.');
  } catch (error) {
    console.error('❌ Twilio initialization failed:', error.message);
  }
} else {
  console.warn('⚠️ WARNING: Twilio credentials are not configured in .env. Twilio client is running in SIMULATION mode.');
  console.warn('All SMS alerts will be simulated and logged directly to the server console.');
}

/**
 * Sends an SMS message to a specific number.
 * Fallbacks to console logging if Twilio is not initialized or fails.
 * @param {string} to - The recipient's phone number
 * @param {string} body - The SMS content
 * @returns {Promise<object>} - Details of the message sent/simulated
 */
const sendSMS = async (to, body) => {
  if (!to) {
    console.error('❌ Cannot send SMS: No recipient phone number provided.');
    return { success: false, error: 'No recipient phone number' };
  }

  if (twilioClient && fromPhone) {
    try {
      const message = await twilioClient.messages.create({
        body,
        from: fromPhone,
        to,
      });
      console.log(`✉️ SMS successfully sent to ${to}. SID: ${message.sid}`);
      return { success: true, sid: message.sid };
    } catch (error) {
      console.error(`❌ Twilio failed to send SMS to ${to}:`, error.message);
      console.log(`📱 [SIMULATED SMS - FALLBACK] To: ${to} | Message: "${body}"`);
      return { success: false, error: error.message, simulated: true };
    }
  } else {
    console.log(`📱 [SIMULATED SMS] To: ${to} | Message: "${body}"`);
    return { success: true, simulated: true };
  }
};

module.exports = {
  sendSMS,
};
