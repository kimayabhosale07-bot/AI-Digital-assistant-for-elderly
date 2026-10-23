const crypto = require('crypto');
const { getDb } = require('../config/firebase');
const { sendFirestoreError } = require('./medicineController');

const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function getSigningKey() {
  const configuredSecret = process.env.ASSISTANT_ACTION_SECRET || process.env.FIREBASE_PRIVATE_KEY;
  if (!configuredSecret) throw new Error('Assistant action signing is not configured.');
  return crypto.createHash('sha256').update(configuredSecret.replace(/\\n/g, '\n')).digest();
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getSigningKey()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function validateMedicineFields(fields) {
  const medicineName = typeof fields?.medicineName === 'string' ? fields.medicineName.trim().slice(0, 100) : '';
  const strength = typeof fields?.strength === 'string' ? fields.strength.trim().slice(0, 40) : '';
  const quantity = typeof fields?.quantity === 'string' ? fields.quantity.trim().slice(0, 40) : '';
  const dosage = typeof fields?.dosage === 'string' && fields.dosage.trim()
    ? fields.dosage.trim().slice(0, 80)
    : [strength, quantity].filter(Boolean).join(', ').slice(0, 80);
  const frequency = typeof fields?.frequency === 'string' ? fields.frequency.trim().slice(0, 100) : '';
  const times = Array.isArray(fields?.times) ? fields.times : [fields?.time];
  const uniqueTimes = [...new Set(times.filter(time => typeof time === 'string').map(time => time.trim()))].sort();
  const route = typeof fields?.route === 'string' ? fields.route.trim().slice(0, 30) : '';
  const mealInstructions = typeof fields?.mealInstructions === 'string' ? fields.mealInstructions.trim().slice(0, 100) : '';
  const instructions = typeof fields?.instructions === 'string' && fields.instructions.trim()
    ? fields.instructions.trim().slice(0, 200)
    : [route, mealInstructions].filter(Boolean).join('; ').slice(0, 200);
  if (fields?.ambiguousProduct) return { error: 'The exact medicine product and strength must be clarified before saving.' };
  if (!medicineName || !dosage || !frequency || !uniqueTimes.length || uniqueTimes.length > 8
    || uniqueTimes.some(time => !TIME_RE.test(time))) {
    return { error: 'The medicine schedule is incomplete or invalid. Review its name, dosage, frequency, and times.' };
  }
  return { fields: { medicineName, strength, quantity, dosage, frequency, time: uniqueTimes[0], times: uniqueTimes, route, mealInstructions, instructions } };
}

function getMissingMedicineFields(fields) {
  const missing = [];
  if (fields.ambiguousProduct) missing.push('the exact product and strength as written on the package label');
  if (!fields.medicineName) missing.push('medicine name');
  if (!fields.strength) missing.push('strength');
  if (!fields.quantity) missing.push('how many tablets, capsules, or other units');
  if (!fields.times?.length) missing.push('time');
  if (!fields.frequency) missing.push('how often to take it');
  return missing;
}

function extractMedicineDetails(messages) {
  const userTexts = messages.filter(message => message.role === 'user').map(message => message.content);
  const combined = userTexts.join('\n');
  const result = { medicineName: '', strength: '', quantity: '', dosage: '', times: [], frequency: '', route: '', mealInstructions: '', instructions: '', ambiguousProduct: false, nameStrengthConflict: false };

  const hasExactLabelContext = userTexts.some(text => /\b(?:package|box|label)\b.{0,50}\b(?:says|reads|lists|shows|states)\b|\bexact\s+(?:product|medicine|label)\s+(?:is|says|reads)\b/i.test(text));
  const labelText = hasExactLabelContext
    ? userTexts.slice().reverse().find(text => /\b(?:package|box|label)\b.{0,50}\b(?:says|reads|lists|shows|states)\b|\bexact\s+(?:product|medicine|label)\s+(?:is|says|reads)\b/i.test(text))
    : '';
  const strengthSource = labelText || combined;
  const anyCompoundStrengthMatch = combined.match(/\b(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)?\s*[-/]\s*\d+(?:\.\d+)?\s*(mg|mcg|g|ml))\b/i);
  const compoundStrengthMatch = strengthSource.match(/\b(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)?\s*[-/]\s*\d+(?:\.\d+)?\s*(mg|mcg|g|ml))\b/i);
  const strengthMatch = compoundStrengthMatch || strengthSource.match(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml)\b/i);
  result.ambiguousProduct = Boolean(compoundStrengthMatch && !hasExactLabelContext);
  if (strengthMatch) {
    result.strength = compoundStrengthMatch
      ? compoundStrengthMatch[1].replace(/\s+/g, '').replace(/(mg|mcg|g|ml)$/i, ' $1')
      : `${strengthMatch[1]} ${strengthMatch[2].toLowerCase()}`;
  }

  const nameMatch = combined.match(/\b(?:add|schedule|create|start|set up)\s+(?:(?:a|an|new)\s+)?(?:(?:medicine|medication|pill|prescription)\s+(?:called\s+|named\s+)?)?([^,;\n.!?]+)/i);
  if (nameMatch) {
    let candidate = nameMatch[1].trim();
    candidate = candidate.replace(/\s+\b(?:at|every|each|once|twice|before|after|with|in the morning|in the evening)\b[\s\S]*$/i, '').trim();
    if (anyCompoundStrengthMatch) candidate = candidate.replace(anyCompoundStrengthMatch[1], '').trim();
    else if (strengthMatch) candidate = candidate.replace(new RegExp(`\\s*${strengthMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${strengthMatch[2]}$`, 'i'), '').trim();
    if (/\b(?:at|every|each|before|after)\b/i.test(nameMatch[1])) candidate = candidate.replace(/\s+\d+(?:\.\d+)?$/, '').trim();
    result.medicineName = candidate.slice(0, 100);
  }
  if (labelText && strengthMatch) {
    const labelMarker = /(?:says|reads|lists|shows|states|exact\s+(?:product|medicine|label)\s+is)\s*[:,-]?\s*/i.exec(labelText);
    if (labelMarker) {
      const labelName = labelText.slice(labelMarker.index + labelMarker[0].length, strengthMatch.index)
        .replace(/^\s*(?:the\s+)?(?:product|medicine)\s+/i, '')
        .replace(/[\s,;:-]+$/, '').trim();
      if (labelName && /^[A-Za-z]/.test(labelName) && labelName.length <= 100) result.medicineName = labelName;
    }
  }
  const productNumber = result.medicineName.match(/\b(\d+(?:\.\d+)?)$/);
  const strengthNumber = result.strength.match(/\b(\d+(?:\.\d+)?)/);
  result.nameStrengthConflict = Boolean(productNumber && strengthNumber && Number(productNumber[1]) !== Number(strengthNumber[1]));
  if (result.nameStrengthConflict) result.ambiguousProduct = true;

  const quantityMatches = [...combined.matchAll(/\b(one|a|an|\d+(?:\.\d+)?)\s*(tablets?|capsules?|pills?|drops?|millilit(?:er|re)s?)\b/gi)];
  const quantityMatch = quantityMatches.at(-1);
  result.quantity = quantityMatch
    ? `${/^one|^a$|^an$/i.test(quantityMatch[1]) ? '1' : quantityMatch[1]} ${quantityMatch[2].toLowerCase()}`
    : '';
  result.dosage = [result.strength, result.quantity].filter(Boolean).join(', ');

  const timeValues = [];
  for (const match of combined.matchAll(/\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/gi)) {
    let hour = Number(match[1]) % 12;
    if (match[3].toLowerCase().startsWith('p')) hour += 12;
    timeValues.push(`${String(hour).padStart(2, '0')}:${match[2] || '00'}`);
  }
  for (const match of combined.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) timeValues.push(`${match[1].padStart(2, '0')}:${match[2]}`);
  result.times = [...new Set(timeValues)].sort();

  if (/\b(twice\s+(?:a\s+day|daily)|two\s+times\s+(?:a\s+day|daily)|2\s+times\s+(?:a\s+day|daily)|breakfast\s+and\s+dinner)\b/i.test(combined)) {
    result.frequency = 'Twice daily';
  } else if (/\b(?:every|each)\s+morning\b/i.test(combined)) {
    result.frequency = 'Every morning';
  } else if (/\b(?:every|each)\s+evening\b/i.test(combined)) {
    result.frequency = 'Every evening';
  } else if (/\b(?:every|each)\s+night\b/i.test(combined)) {
    result.frequency = 'Every night';
  } else if (/\b(once\s+(?:a\s+day|daily)|daily|every\s+day)\b/i.test(combined)) {
    result.frequency = 'Daily';
  } else {
    const frequency = combined.match(/\b(once|twice|three times|four times)\s+(?:a\s+day|daily|a\s+week|weekly)\b/i);
    if (frequency) result.frequency = frequency[0].replace(/\s+/g, ' ').trim();
  }

  result.mealInstructions = [...new Set([...combined.matchAll(/\b(?:before\s+(?:breakfast|lunch|dinner|food)|after\s+(?:breakfast|lunch|dinner|food)|with\s+food)\b/gi)].map(match => match[0].toLowerCase()))].join('; ');
  if (/\b(?:orally|oral(?:ly)?|by mouth)\b/i.test(combined)
    || (result.quantity && /\bwith\s+water\b/i.test(combined) && /\b(?:tablets?|capsules?|pills?)\b/i.test(combined))) result.route = 'oral';
  const hasWater = /\bwith\s+water\b/i.test(combined);
  result.instructions = [result.route, hasWater ? 'with water' : '', result.mealInstructions].filter(Boolean).join('; ').slice(0, 200);
  return result;
}

function hasMedicineSchedulingIntent(messages) {
  const userText = messages.filter(message => message.role === 'user').map(message => message.content).join(' ');
  const command = /\b(?:add|schedule|create|start|set up)\b/i.test(userText);
  const medicationWord = /\b(?:medicine|medication|pill|prescription)\b/i.test(userText);
  const productWithSchedule = /\b(?:add|schedule|create|start|set up)\s+(?:[A-Z][\w-]*\s+)?\d+(?:[/-]\d+)?\s*(?:mg|mcg|g|ml)?\b/i.test(userText)
    || /\b(?:add|schedule|create|start|set up)\s+[A-Z][\w-]*\b[\s\S]{0,100}\b(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|every\s+(?:day|morning|evening)|one\s+tablet)\b/i.test(userText);
  return command && (medicationWord || productWithSchedule);
}

function isMedicineWorkflowReply(message) {
  return /^(?:yes(?:,?\s+(?:please|save it|add it|go ahead))?|confirm(?:ed)?|save it)[.! ]*$/i.test(message)
    || /\badd\s+that\s+medicine\b/i.test(message)
    || /\b(?:confirm|save)\b[\s\S]{0,60}\b(?:it|this|medicine|schedule|log)\b|\badd\s+it\s+(?:to|in)\s+(?:the\s+)?medicine\s+(?:log|list|schedule)\b/i.test(message);
}

function isMedicineFieldReply(message) {
  return /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)\b|\b(?:tablets?|capsules?|pills?|drops?|every\s+(?:day|morning|evening|night)|daily|weekly|breakfast|dinner|lunch|with\s+water|by\s+mouth|orally|package|label|box|exact product)\b|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(message);
}

function createMedicineDraftId(userId, now = Date.now()) {
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 150) throw new Error('A valid Carewise profile is required to start a medicine draft.');
  const payload = { version: 1, purpose: 'medicine-draft', draftId: crypto.randomBytes(16).toString('hex'), userId: userId.trim(), expiresAt: now + PENDING_ACTION_TTL_MS };
  return signPayload(payload);
}

function verifyMedicineDraftId(token, userId, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 5000) return { error: 'The medicine draft is invalid or expired.' };
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return { error: 'The medicine draft is invalid or expired.' };
  let expected;
  try { expected = crypto.createHmac('sha256', getSigningKey()).update(encoded).digest(); }
  catch (_) { return { error: 'Medicine confirmation is not configured on the backend.' }; }
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return { error: 'The medicine draft is invalid or expired.' };
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.version !== 1 || payload.purpose !== 'medicine-draft' || !payload.draftId || payload.userId !== userId || payload.expiresAt <= now) return { error: 'The medicine draft is invalid or expired.' };
    return { payload };
  } catch (_) { return { error: 'The medicine draft is invalid or expired.' }; }
}

function createPendingMedicineAction(userId, fields, medicineDraftId) {
  const checked = validateMedicineFields(fields);
  if (checked.error) throw new Error(checked.error);
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 150) throw new Error('A valid Carewise profile is required to prepare this schedule.');
  const draft = medicineDraftId ? verifyMedicineDraftId(medicineDraftId, userId) : null;
  if (draft?.error) throw new Error(draft.error);
  const payload = {
    version: 1,
    actionId: draft?.payload.draftId || crypto.randomBytes(16).toString('hex'),
    userId: userId.trim(),
    fields: checked.fields,
    expiresAt: draft?.payload.expiresAt || Date.now() + PENDING_ACTION_TTL_MS,
  };
  return { ...checked.fields, confirmationToken: signPayload(payload) };
}

function verifyPendingMedicineAction(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 5000) return { error: 'This medicine confirmation is invalid. Please review the schedule again.' };
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return { error: 'This medicine confirmation is invalid. Please review the schedule again.' };
  let expected;
  try { expected = crypto.createHmac('sha256', getSigningKey()).update(encoded).digest(); }
  catch (_) { return { error: 'Medicine confirmation is not configured on the backend.' }; }
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch (_) { supplied = Buffer.alloc(0); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return { error: 'This medicine confirmation is invalid. Please review the schedule again.' };
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.version !== 1 || !payload.actionId || !payload.userId || payload.expiresAt <= now) return { error: 'This medicine confirmation has expired. Please review the schedule again.', expired: true };
    const checked = validateMedicineFields(payload.fields);
    if (checked.error) return { error: checked.error };
    return { payload: { ...payload, fields: checked.fields } };
  } catch (_) {
    return { error: 'This medicine confirmation is invalid. Please review the schedule again.' };
  }
}

function normalized(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }

async function confirmAssistantMedicine(req, res) {
  if (req.body?.confirmed !== true) return res.status(400).json({ error: 'Explicit confirmation is required before saving this medicine schedule.' });
  const verified = verifyPendingMedicineAction(req.body?.confirmationToken);
  if (verified.error) return res.status(verified.expired ? 410 : 400).json({ error: verified.error });
  const { payload } = verified;
  if (req.body?.userId !== payload.userId) return res.status(403).json({ error: 'The signed-in profile changed. Reopen the schedule and confirm it again.' });

  try {
    const db = req.app?.locals?.db || getDb();
    const userRef = db.collection('users').doc(payload.userId);
    const medicinesRef = db.collection('medicines');
    const actionDocs = payload.fields.times.map(time => {
      const medId = `assistant_${crypto.createHash('sha256').update(`${payload.actionId}:${time}`).digest('hex').slice(0, 40)}`;
      return { time, ref: medicinesRef.doc(medId) };
    });
    const createdAt = new Date().toISOString();
    const outcome = await db.runTransaction(async transaction => {
      const userSnapshot = await transaction.get(userRef);
      if (!userSnapshot.exists) {
        const error = new Error('The Carewise profile no longer exists. No medicine was saved.');
        error.status = 404;
        throw error;
      }
      const existingSnapshot = await transaction.get(medicinesRef.where('userId', '==', payload.userId));
      const existing = existingSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const actionSnapshots = await Promise.all(actionDocs.map(item => transaction.get(item.ref)));
      const creates = [];
      const alreadyPresent = [];
      for (let index = 0; index < actionDocs.length; index += 1) {
        const { time, ref } = actionDocs[index];
        const claimed = actionSnapshots[index];
        if (claimed.exists) {
          alreadyPresent.push({ medId: claimed.id, time, ...claimed.data() });
          continue;
        }
        const duplicate = existing.find(item => normalized(item.medicineName) === normalized(payload.fields.medicineName)
          && normalized(item.dosage) === normalized(payload.fields.dosage)
          && item.time === time);
        if (duplicate) {
          alreadyPresent.push({ medId: duplicate.medId || duplicate.id, time });
          continue;
        }
        creates.push({ ref, time });
      }
      for (const { ref, time } of creates) {
        const medicine = {
          medId: ref.id,
          userId: payload.userId,
          medicineName: payload.fields.medicineName,
          dosage: payload.fields.dosage,
          time,
          frequency: payload.fields.frequency,
          status: 'pending',
          createdAt,
        };
        if (payload.fields.instructions) medicine.instructions = payload.fields.instructions;
        transaction.create(ref, medicine);
      }
      return { created: creates.map(item => ({ medId: item.ref.id, time: item.time })), alreadyPresent };
    });

    const allAlreadyPresent = outcome.created.length === 0;
    return res.status(200).json({
      success: true,
      duplicate: allAlreadyPresent,
      createdCount: outcome.created.length,
      alreadyPresentCount: outcome.alreadyPresent.length,
      message: allAlreadyPresent
        ? 'This medicine schedule is already present. No duplicate was created.'
        : outcome.alreadyPresent.length
          ? 'The missing times were added; existing matching schedules were left unchanged.'
          : 'The confirmed medicine schedule was saved successfully.',
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    return sendFirestoreError(res, 'confirm assistant medicine', error);
  }
}

module.exports = {
  PENDING_ACTION_TTL_MS,
  validateMedicineFields,
  getMissingMedicineFields,
  extractMedicineDetails,
  hasMedicineSchedulingIntent,
  isMedicineWorkflowReply,
  isMedicineFieldReply,
  createMedicineDraftId,
  verifyMedicineDraftId,
  createPendingMedicineAction,
  verifyPendingMedicineAction,
  confirmAssistantMedicine,
};
