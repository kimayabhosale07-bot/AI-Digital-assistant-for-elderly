/**
 * ============================================================
 * REMINDERS.JS — Medicine & Appointment Lists Handler
 * ============================================================
 * Handles rendering medicine reminders, marking taken/missed,
 * adding/editing medicines, and rendering appointments.
 * ============================================================
 */



/**
 * Load & Render Medicine Reminders
 */
async function loadReminders(containerId = 'reminders-list') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const result = await CareMateAPI.getMedicines();
  if (!result.success) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">💊</div>
        <h4 class="empty-state__title">Error loading medicines</h4>
        <p class="empty-state__description">Could not fetch medicines from server.</p>
        <button class="btn btn--primary" onclick="Reminders.reloadReminders()">Retry</button>
      </div>
    `;
    return;
  }

  renderMedicineReminders(result.data || [], container);
}

/**
 * Render medicine reminders array into container
 */
function renderMedicineReminders(reminders, container) {
  if (!container) return;

  if (!reminders || reminders.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">💊</div>
        <h4 class="empty-state__title">No medicines yet</h4>
        <p class="empty-state__description">Add your first medicine reminder to get started.</p>
        <button class="btn btn--primary" onclick="Reminders.showAddMedicineModal()">+ Add Medicine</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  reminders.forEach((med) => {
    let badgeClass = 'badge--upcoming';
    let badgeText = 'UPCOMING';
    let iconClass = 'medicine-card__icon--pill';
    let iconSymbol = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5l-6-6a4.5 4.5 0 1 1 6.5-6.5l6 6a4.5 4.5 0 1 1-6.5 6.5z"></path><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"></line></svg>';

    if (med.dosage.toLowerCase().includes('capsule')) {
      iconClass = 'medicine-card__icon--capsule';
    }

    if (med.status === 'taken') {
      badgeClass = 'badge--taken';
      badgeText = '✓ TAKEN';
    } else if (med.status === 'missed') {
      badgeClass = 'badge--missed';
      badgeText = '⚠️ MISSED';
    }

    const card = document.createElement('div');
    card.className = 'medicine-card';
    card.innerHTML = `
      <div class="medicine-card__icon ${iconClass}">
        ${iconSymbol}
      </div>
      <div class="medicine-card__content">
        <div class="medicine-card__name">
          ${med.name}
          <span class="badge ${badgeClass}" style="margin-left: auto;">${badgeText}</span>
        </div>
        <div class="medicine-card__details">
          <div class="medicine-card__detail-row">
            <span class="medicine-card__detail-label">Time</span>
            <span>${med.time} (${med.repeat})</span>
          </div>
          <div class="medicine-card__detail-row">
            <span class="medicine-card__detail-label">Dosage</span>
            <span>${med.dosage}</span>
          </div>
          ${med.notes ? `
          <div class="medicine-card__detail-row">
            <span class="medicine-card__detail-label">Notes</span>
            <span>${med.notes}</span>
          </div>` : ''}
        </div>
        
        <div class="medicine-card__actions">
          ${med.status !== 'taken' ? `
            <button class="btn btn--sm btn--success" onclick="Reminders.markMedicineTaken('${med.id}')">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Mark as Taken
            </button>
          ` : ''}
          ${med.status !== 'missed' && med.status !== 'taken' ? `
            <button class="btn btn--sm btn--ghost" style="color: var(--color-warning);" onclick="Reminders.markMedicineMissed('${med.id}')">
              Mark Missed
            </button>
          ` : ''}
          <button class="btn btn--sm btn--ghost">Edit</button>
          <button class="btn btn--sm btn--icon btn--ghost" style="margin-left: auto;">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
          </button>
        </div>
        ${med.status === 'taken' ? `
          <div class="medicine-card__taken-info">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Taken at ${med.time}
          </div>
        ` : ''}
      </div>
    `;

    container.appendChild(card);
  });
}

/**
 * Add medicine handler
 */
async function addMedicine(data) {
  const result = await CareMateAPI.createMedicine(data);
  if (!result.success) {
    if (typeof CareMateApp !== 'undefined') {
      CareMateApp.showFeedback({
        type: 'error',
        title: 'Error',
        message: result.error || 'Failed to add medicine',
        speakText: 'Failed to add medicine. Please try again.',
      });
    }
    return;
  }

  loadReminders();

  if (typeof CareMateApp !== 'undefined') {
    CareMateApp.showFeedback({
      type: 'success',
      title: 'Medicine Saved',
      message: `Added ${result.data.medicineName} for ${result.data.time}.`,
      speakText: `I've added ${result.data.medicineName} to your schedule for ${result.data.time}.`,
    });
  }
}

/**
 * Edit medicine handler placeholder
 */
function editMedicine(id) {
  console.log('[Reminders] Edit medicine ID:', id);
  // TODO: Open edit modal & update item
}

/**
 * Delete medicine handler
 */
function deleteMedicine(id) {
  mockMedicines = mockMedicines.filter(m => m.id !== id);
  loadReminders();
}

/**
 * Mark medicine as taken
 */
async function markMedicineTaken(id) {
  const result = await CareMateAPI.updateMedicineStatus(id, 'taken');
  if (!result.success) {
    if (typeof CareMateApp !== 'undefined') {
      CareMateApp.showFeedback({
        type: 'error',
        title: 'Error',
        message: result.error || 'Failed to update medicine status',
        speakText: 'Failed to mark medicine as taken. Please try again.',
      });
    }
    return;
  }

  loadReminders();

  if (typeof CareMateApp !== 'undefined') {
    CareMateApp.showFeedback({
      type: 'success',
      title: 'Medicine Marked as Taken',
      message: result.data ? `${result.data.name} marked as taken. Good job!` : 'Medicine marked as taken. Good job!',
      speakText: `I've marked your medicine as taken.`,
    });
  }
}

/**
 * Mark medicine as missed
 */
async function markMedicineMissed(id) {
  const result = await CareMateAPI.updateMedicineStatus(id, 'missed');
  if (!result.success) {
    if (typeof CareMateApp !== 'undefined') {
      CareMateApp.showFeedback({
        type: 'error',
        title: 'Error',
        message: result.error || 'Failed to update medicine status',
        speakText: 'Failed to mark medicine as missed. Please try again.',
      });
    }
    return;
  }

  loadReminders();

  if (typeof CareMateApp !== 'undefined') {
    CareMateApp.showFeedback({
      type: 'warning',
      title: 'Medicine Marked as Missed',
      message: result.data ? `${result.data.name} marked as missed.` : 'Medicine marked as missed.',
      speakText: `I've marked your medicine as missed. Please check with your doctor if needed.`,
    });
  }
}

// ── Doctor Appointments Handlers ──

async function loadAppointments(containerId = 'appointments-list') {
  const container = document.getElementById(containerId);
  if (!container) return;
  const userId = window.CareMateAPI.getCurrentUserId();
  if (!userId) {
    container.innerHTML = '<p role="alert">Sign in to view appointments.</p>';
    return;
  }
  container.innerHTML = '<p role="status">Loading appointments…</p>';
  try {
    const result = await window.CareMateAPI.getAppointments(userId);
    if (!result.success || !Array.isArray(result.data)) {
      container.innerHTML = '<div role="alert">Appointments could not be loaded. <button type="button" onclick="Reminders.loadAppointments()">Retry</button></div>';
      return;
    }
    renderAppointments(window.CareMateAPI.filterUpcomingAppointments(result.data, userId), container);
  } catch (_) {
    container.innerHTML = '<div role="alert">Appointments could not be loaded. Check your connection and <button type="button" onclick="Reminders.loadAppointments()">retry</button>.</div>';
  }
}

function escapeReminderText(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderAppointments(appointments, container) {
  if (!container) return;
  if (!appointments || appointments.length === 0) {
    container.innerHTML = '<div class="empty-state"><h4 class="empty-state__title">No appointments</h4><p class="empty-state__description">Schedule your next doctor visit to keep track.</p></div>';
    return;
  }
  container.innerHTML = appointments.map(appointment => {
    const date = new Date(`${appointment.date}T00:00:00`);
    const dateLabel = Number.isNaN(date.getTime()) ? escapeReminderText(appointment.date) : escapeReminderText(date.toLocaleDateString());
    return `<article class="appointment-item"><div class="appointment-item__content"><h3 class="appointment-item__doctor">${escapeReminderText(appointment.doctorName)}</h3><div class="appointment-item__detail">${dateLabel} at ${escapeReminderText(appointment.time)}</div><div class="appointment-item__detail text-muted">${escapeReminderText(appointment.location)}</div></div></article>`;
  }).join('');
}

async function addAppointment(data) {
  const userId = window.CareMateAPI.getCurrentUserId();
  const result = await window.CareMateAPI.addAppointment({
    userId,
    doctorName: data.doctorName || data.doctor,
    date: data.date,
    time: data.time,
    location: data.location,
  });
  if (!result.success) {
    if (typeof CareMateApp !== 'undefined') CareMateApp.showFeedback({ type: 'error', title: 'Could not save appointment', message: result.error || 'Please review the details and try again.' });
    return false;
  }
  await loadAppointments();
  if (typeof CareMateApp !== 'undefined') CareMateApp.showFeedback({ type: 'success', title: 'Appointment Saved', message: 'The appointment was saved successfully.' });
  return true;
}
window.Reminders = {
  loadReminders,
  renderMedicineReminders,
  addMedicine,
  editMedicine,
  deleteMedicine,
  markMedicineTaken,
  markMedicineMissed,
  loadAppointments,
  renderAppointments,
  addAppointment,
};
