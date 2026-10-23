/**
 * ============================================================
 * REMINDERS.JS — Medicine & Appointment Lists Handler
 * ============================================================
 * Handles rendering medicine reminders, marking taken/missed,
 * adding/editing medicines, and rendering appointments.
 * ============================================================
 */



let mockAppointments = [
  {
    id: 'apt-1',
    doctor: 'Dr. Priya Sharma',
    specialty: 'General Physician',
    date: 'Today',
    time: '03:30 PM',
    location: 'City Care Hospital',
    reason: 'Regular Blood Pressure Checkup',
    notes: 'Bring previous medical reports',
  },
];

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

function loadAppointments(containerId = 'appointments-list') {
  const container = document.getElementById(containerId);
  if (!container) return;

  renderAppointments(mockAppointments, container);
}

function renderAppointments(appointments, container) {
  if (!container) return;

  if (!appointments || appointments.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📅</div>
        <h4 class="empty-state__title">No appointments</h4>
        <p class="empty-state__description">Schedule your next doctor visit to keep track.</p>
        <button class="btn btn--primary" onclick="Reminders.showAddAppointmentModal()">+ Add Appointment</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  // Featured next appointment (first one)
  const nextApt = appointments[0];
  if (nextApt) {
    const featuredCard = document.createElement('div');
    featuredCard.className = 'card card--featured';
    featuredCard.innerHTML = `
      <div class="card__header">
        <h4 class="text-sm text-muted mb-0">Next Appointment</h4>
      </div>
      <div style="display: flex; gap: var(--space-20); align-items: flex-start; margin-top: var(--space-8);">
        <div class="date-block">
          <div class="date-block__day">10</div>
          <div class="date-block__month">AUG</div>
        </div>
        <div style="flex: 1;">
          <div class="badge badge--today" style="margin-bottom: var(--space-8);">Today at ${nextApt.time}</div>
          <h3 style="font-size: 20px; font-weight: var(--font-weight-bold); margin-bottom: var(--space-4);">${nextApt.doctor}</h3>
          <div class="text-sm text-secondary" style="margin-bottom: var(--space-4);">${nextApt.specialty}</div>
          <div class="text-sm text-secondary" style="display: flex; align-items: center; gap: var(--space-4);">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            ${nextApt.location}
          </div>
          <button class="btn btn--sm btn--primary mt-16" onclick="CareMateApp.showFeedback({ type: 'info', title: 'Visit Details', message: '${nextApt.doctor} at ${nextApt.time}', speakText: 'Your visit with ${nextApt.doctor} is scheduled for ${nextApt.time}.' })">
            View Details
          </button>
        </div>
      </div>
    `;
    container.appendChild(featuredCard);
  }

  // Upcoming appointments list
  if (appointments.length > 1) {
    const listContainer = document.createElement('div');
    listContainer.className = 'card';
    listContainer.style.padding = '0';
    
    let listHtml = '';
    for (let i = 1; i < appointments.length; i++) {
      const apt = appointments[i];
      // mock dates for the list based on index to look good
      const day = 10 + i * 3;
      listHtml += `
        <div class="appointment-item">
          <div class="date-block" style="background: transparent;">
            <div class="date-block__day" style="color: var(--color-text);">${day}</div>
            <div class="date-block__month" style="color: var(--color-text-muted);">AUG</div>
          </div>
          <div class="appointment-item__content">
            <div class="appointment-item__doctor">${apt.doctor}</div>
            <div class="appointment-item__detail">${apt.specialty}</div>
            <div class="appointment-item__detail text-muted">${apt.location}</div>
          </div>
          <div class="appointment-item__time">
            ${apt.time}
            <div style="margin-top: var(--space-8); display: flex; justify-content: flex-end;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </div>
          </div>
        </div>
      `;
    }
    listContainer.innerHTML = listHtml;
    container.appendChild(listContainer);
  }
}

function addAppointment(data) {
  const newApt = {
    id: 'apt-' + Date.now(),
    doctor: data.doctor,
    specialty: data.specialty || 'General Practitioner',
    date: data.date || 'Upcoming',
    time: data.time,
    location: data.location || 'Clinic',
    notes: data.notes || '',
  };

  mockAppointments.unshift(newApt);
  loadAppointments();

  if (typeof CareMateApp !== 'undefined') {
    CareMateApp.showFeedback({
      type: 'success',
      title: 'Appointment Saved',
      message: `Appointment scheduled with ${newApt.doctor}.`,
      speakText: `I've saved your appointment with ${newApt.doctor} for ${newApt.time}.`,
    });
  }
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
