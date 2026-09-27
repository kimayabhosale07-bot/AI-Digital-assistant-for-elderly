const { getDb } = require('../config/firebase');

/**
 * POST /register
 * Registers a new user. If userId is provided, it uses it (e.g. Firebase Auth UID). 
 * Otherwise, Firestore auto-generates a document ID.
 */
const registerUser = async (req, res) => {
  try {
    const db = getDb();
    const { userId, name, age, phone, emergencyContacts } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: name and phone are required.' });
    }

    // Validate and format emergencyContacts
    const formattedContacts = [];
    if (Array.isArray(emergencyContacts)) {
      for (const contact of emergencyContacts) {
        if (contact.name && contact.phone) {
          formattedContacts.push({
            name: contact.name,
            relation: contact.relation || 'Emergency Contact',
            phone: contact.phone
          });
        }
      }
    }

    const userData = {
      name,
      age: age ? Number(age) : null,
      phone,
      emergencyContacts: formattedContacts,
      createdAt: new Date().toISOString()
    };

    let finalUserId;

    if (userId) {
      finalUserId = userId;
      await db.collection('users').doc(userId).set(userData, { merge: true });
    } else {
      const docRef = await db.collection('users').add(userData);
      finalUserId = docRef.id;
    }

    return res.status(201).json({
      message: 'User registered successfully',
      userId: finalUserId,
      user: { userId: finalUserId, ...userData }
    });
  } catch (error) {
    console.error('Error in registerUser:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /user/:userId
 * Fetches user profile by userId.
 */
const getUserProfile = async (req, res) => {
  try {
    const db = getDb();
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID parameter is required.' });
    }

    const userDoc = await db.collection('users').doc(userId).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json({
      userId: userDoc.id,
      ...userDoc.data()
    });
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  registerUser,
  getUserProfile,
};
