/**
 * ============================================================
 * HEALTH.JS — Health Log & Neutral Attention Flagging Layer
 * ============================================================
 * Log vitals (Blood Pressure, Temperature, Heart Rate, Sugar, Weight),
 * validate readings, and flag abnormal values using neutral, non-diagnostic
 * attention guidance.
 * ============================================================
 */

let mockHealthRecords = [
  {
    id: 'h-1',
    type: 'Blood Pressure',
    value: '120 / 80',
    unit: 'mmHg',
    status: 'normal',
    date: 'Today, 8:00 AM',
    notes: 'Morning measurement',
  },
  {
    id: 'h-2',
    type: 'Body Temperature',
    value: '98.4',
    unit: '°F',
    status: 'normal',
    date: 'Today, 8:05 AM',
    notes: 'Normal body temp',
  },
  {
    id: 'h-3',
    type: 'Blood Pressure',
    value: '160 / 100',
    unit: 'mmHg',
    status: 'attention',
    date: 'Yesterday, 6:30 PM',
    notes: 'Felt slightly tired',
  },
];

// Placeholder thresholds — clearly commented for future configurable medical guidelines
const THRESHOLDS = {
  bp_systolic: { max: 140, min: 90, label: 'Blood Pressure' },
  sugar: { max: 140, min: 70, label: 'Blood Sugar' },
  temp: { max: 99.5, min: 97.0, label: 'Temperature' },
  heart_rate: { max: 100, min: 60, label: 'Heart Rate' },
};

/**
 * Load & Render Health Records
 */
function loadHealthRecords(containerId = 'health-history-list') {
  const container = document.getElementById(containerId);
  if (!container) return;

  renderHealthRecords(mockHealthRecords, container);
}

/**
 * Render health records into container
 */
function renderHealthRecords(records, container) {
  if (!container) return;

  if (!records || records.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">❤️</div>
        <h4 class="empty-state__title">No health readings</h4>
        <p class="empty-state__description">Start recording your health information to track changes over time.</p>
        <button class="btn btn--primary" onclick="window.scrollTo({ top: 0, behavior: 'smooth' })">+ Log Reading</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  const listContainer = document.createElement('div');
  listContainer.className = 'card';
  listContainer.style.padding = '0';
  
  let listHtml = '';
  records.forEach((rec) => {
    let badgeHtml = '';
    if (rec.status === 'attention') {
      badgeHtml = `<span class="badge badge--attention">Attention</span>`;
    } else {
      badgeHtml = `<span class="badge badge--normal">Normal</span>`;
    }

    let icon = '❤️';
    if (rec.type.toLowerCase().includes('temp')) icon = '🌡️';
    else if (rec.type.toLowerCase().includes('sugar')) icon = '🩸';
    else if (rec.type.toLowerCase().includes('weight')) icon = '⚖️';

    listHtml += `
      <div class="reading-item" style="padding: var(--space-16);">
        <div class="reading-item__icon">${icon}</div>
        <div class="reading-item__content">
          <div class="reading-item__type">${rec.type}</div>
          <div class="reading-item__value">${rec.value} ${rec.unit}</div>
          <div class="reading-item__date">${rec.date}</div>
        </div>
        <div class="reading-item__badge">
          ${badgeHtml}
        </div>
      </div>
    `;
  });
  
  listContainer.innerHTML = listHtml;
  container.appendChild(listContainer);
}

/**
 * Validate & Flag abnormal health reading (neutral language)
 */
function validateHealthReading(type, value) {
  // Simple non-diagnostic threshold check
  const numVal = parseFloat(value);
  if (isNaN(numVal)) return 'normal';

  if (type === 'bp' && numVal >= 140) return 'attention';
  if (type === 'sugar' && numVal >= 150) return 'attention';
  if (type === 'temp' && numVal >= 99.5) return 'attention';

  return 'normal';
}

/**
 * Add health reading
 */
function addHealthReading(data) {
  const status = validateHealthReading(data.typeKey, data.value);
  const newRec = {
    id: 'h-' + Date.now(),
    type: data.typeLabel || 'Health Reading',
    value: data.value,
    unit: data.unit || '',
    status: status,
    date: 'Just now',
    notes: data.notes || '',
  };

  mockHealthRecords.unshift(newRec);
  loadHealthRecords();

  if (status === 'attention') {
    if (typeof CareMateApp !== 'undefined') {
      CareMateApp.showFeedback({
        type: 'warning',
        title: '🟠 ATTENTION',
        message: `${newRec.type} of ${newRec.value} ${newRec.unit} is higher than your usual range. Consider contacting your provider.`,
        speakText: `Your ${newRec.type} reading of ${newRec.value} is higher than your usual range. Please consider contacting your doctor.`,
      });
    }
  } else {
    if (typeof CareMateApp !== 'undefined') {
      CareMateApp.showFeedback({
        type: 'success',
        title: 'Reading Recorded',
        message: `${newRec.type} reading of ${newRec.value} ${newRec.unit} recorded.`,
        speakText: `I've logged your ${newRec.type} reading as ${newRec.value}. It looks normal.`,
      });
    }
  }
}

window.Health = {
  loadHealthRecords,
  renderHealthRecords,
  addHealthReading,
  validateHealthReading,
};
