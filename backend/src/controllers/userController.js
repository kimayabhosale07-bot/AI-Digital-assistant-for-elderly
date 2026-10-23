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
      ...userDoc.data(),
      userId: userDoc.id,
    });
  } catch (error) {
    console.error('Error in getUserProfile:', error);
    return res.status(500).json({ error: error.message });
  }
};

/**
 * GET /user/by-phone/:phone
 * Resolves an existing profile to its Firestore document ID. Older demo
 * sessions may have duplicate documents for the same phone and name; in that
 * case use the most recently registered copy, without creating another user.
 */
const getUserProfileByPhone = async (req, res) => {
  try {
    const db = getDb();
    const phone = String(req.params.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

    const snapshot = await db.collection('users').where('phone', '==', phone).get();
    if (snapshot.empty) return res.status(404).json({ error: 'No Carewise profile was found for that phone number.' });

    const profiles = snapshot.docs.map(doc => ({ id: doc.id, profile: doc.data() }));
    const names = new Set(profiles.map(item => String(item.profile.name || '').trim().toLowerCase()));
    if (names.size > 1) {
      return res.status(409).json({ error: 'More than one profile uses this phone number. Sign in with your Profile ID.' });
    }

    profiles.sort((a, b) => String(b.profile.createdAt || '').localeCompare(String(a.profile.createdAt || '')));
    const selected = profiles[0];
    return res.status(200).json({ ...selected.profile, userId: selected.id });
  } catch (error) {
    console.error('Error in getUserProfileByPhone:', error.message);
    return res.status(500).json({ error: 'Could not look up this profile. Please try again.' });
  }
};

module.exports = {
  registerUser,
  getUserProfile,
  getUserProfileByPhone,
};
