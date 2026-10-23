const { getDb } = require('../config/firebase');
const { getSmsConfiguration, sendRealSMS } = require('../config/twilio');

const getSmsStatus = (req, res) => res.status(200).json({ provider: 'Twilio', ...getSmsConfiguration() });

const sendTestSms = async (req, res) => {
  try {
    const { userId, recipient, confirmed } = req.body;
    if (!userId || !recipient || confirmed !== true) {
      return res.status(400).json({ error: 'Confirm the test and provide the account holder phone number.' });
    }
    const configuration = getSmsConfiguration();
    if (!configuration.configured) return res.status(503).json({ error: configuration.error || 'SMS provider is not configured.', provider: 'Twilio', missing: configuration.missing });
    const user = await getDb().collection('users').doc(userId).get();
    if (!user.exists || user.data().phone !== recipient) return res.status(403).json({ error: 'Test SMS can only be sent to the signed-in account phone number.' });
    const result = await sendRealSMS(recipient, 'Carewise test message. SMS delivery is working.');
    return res.status(200).json({ success: true, provider: 'Twilio', referenceId: result.sid, deliveryStatus: result.status });
  } catch (error) {
    console.error('Test SMS failed:', error.message);
    return res.status(502).json({ error: 'Twilio could not send the test message.' });
  }
};

module.exports = { getSmsStatus, sendTestSms };
