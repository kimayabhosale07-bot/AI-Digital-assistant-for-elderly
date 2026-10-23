const twilio = require('twilio');
require('dotenv').config();

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;
let configurationError = null;

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
    configurationError = 'Twilio rejected the configured credentials. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.';
    console.error('Twilio initialization failed; verify the backend Twilio configuration.');
  }
} else {
  configurationError = 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in the backend environment.';
  console.warn('Twilio is not configured; SMS sends will report failure instead of simulating delivery.');
}

/**
 * Sends an SMS message to a specific number.
 * Returns a failure state if Twilio is not initialized or fails.
 * @param {string} to - The recipient's phone number
 * @param {string} body - The SMS content
 * @returns {Promise<object>} - Provider result for the message send
 */
const sendSMS = async (to, body) => {
  if (!to) return { success: false, error: 'No recipient phone number' };
  if (!twilioClient || !fromPhone) {
    return { success: false, configured: false, error: configurationError || 'Twilio SMS is not configured.' };
  }
  try {
    const message = await twilioClient.messages.create({ body, from: fromPhone, to });
    return { success: true, sid: message.sid, status: message.status };
  } catch (error) {
    console.error('Twilio could not send an SMS message.');
    return { success: false, error: 'Twilio could not send the SMS message.' };
  }
};

const getSmsConfiguration = () => ({
  configured: Boolean(twilioClient && fromPhone),
  missing: [
    !accountSid || accountSid.includes('your-') ? 'TWILIO_ACCOUNT_SID' : null,
    !authToken || authToken.includes('your-') ? 'TWILIO_AUTH_TOKEN' : null,
    !fromPhone || fromPhone.includes('your-') ? 'TWILIO_PHONE_NUMBER' : null,
  ].filter(Boolean),
  error: configurationError,
});

const sendRealSMS = async (to, body) => {
  if (!getSmsConfiguration().configured) throw new Error('Twilio provider is not configured.');
  const message = await twilioClient.messages.create({ body, from: fromPhone, to });
  return { sid: message.sid, status: message.status };
};

module.exports = {
  sendSMS,
  getSmsConfiguration,
  sendRealSMS,
};
