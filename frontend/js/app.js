/**
 * ============================================================
 * APP.JS — Shared Core Application Behavior & Navigation
 * ============================================================
 * Handles page initialization, persistent bottom/sidebar navigation,
 * global header SOS shortcut, toast/alert feedback, and family contacts.
 * ============================================================
 */

let mockContacts = [
  {
    id: 'c-1',
    name: 'Priya',
    relation: 'Daughter',
    phone: '+91 98765 43210',
    emergencyAlerts: true,
  },
  {
    id: 'c-2',
    name: 'Robert',
    relation: 'Caregiver / Nurse',
    phone: '+91 91234 56789',
    emergencyAlerts: true,
  },
];

const NAV_DESTINATIONS = [
  { href: 'dashboard.html', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>', label: 'Home', id: 'nav-home' },
  { href: 'reminders.html', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M10.5 20.5l-6-6a4.5 4.5 0 1 1 6.5-6.5l6 6a4.5 4.5 0 1 1-6.5 6.5z"></path><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"></line></svg>', label: 'Medicines', id: 'nav-medicines' },
  { href: 'appointments.html', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>', label: 'Appointments', id: 'nav-visits' },
  { href: 'health.html', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>', label: 'Health', id: 'nav-health' },
  { href: 'contacts.html', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>', label: 'Contacts', id: 'nav-contacts' },
];

/**
 * Main Application Initializer
 */
async function initApp(pageConfig = {}) {
  const activePage = pageConfig.activePage || getPageFilename();

  // Initialize user profile from storage
  let userId = CareMateAPI.getCurrentUserId();
  if (!userId) {
    userId = getCurrentUserIdFromStorage();
    if (userId) {
      CareMateAPI.setCurrentUserId(userId);
    }
  }

  // Load user profile for greeting and sidebar BEFORE rendering navigation
  if (userId) {
    await loadUserProfile(userId);
  }

  initNavigation(activePage);
  initGlobalSOS();
  initFeedback();

  handlePageLoad(activePage);

  console.log(`[CareMate App] Initialized page: ${activePage}`);
}

/**
 * Load user profile and update UI
 */
async function loadUserProfile(userId) {
  const result = await window.CareMateAPI.getUserProfile(userId);
  if (result.success && result.data && result.data.user) {
    const user = result.data.user;
    // Update sidebar profile
    const profileEl = document.querySelector('.sidebar-profile');
    if (profileEl) {
      const nameEl = profileEl.querySelector('.sidebar-profile__name');
      if (nameEl) {
        nameEl.textContent = user.name || 'User';
      }
    }
    // Update greeting on dashboard
    const greetingTitle = document.getElementById('greeting-title');
    if (greetingTitle) {
      greetingTitle.textContent = `Good ${getGreetingTime()}, ${user.name || 'Asha'}`;
    }
  }
}

/**
 * Get appropriate greeting based on time of day
 */
function getGreetingTime() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

/**
 * Get the current userId from storage (backup)
 */
function getCurrentUserIdFromStorage() {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('caremate_user_id');
    if (stored) return stored;
  }
  return null;
}

function getPageFilename() {
  const path = window.location.pathname;
  const name = path.split('/').pop();
  return name || 'index.html';
}

/**
 * Render Persistent Navigation (Bottom Nav on Mobile, Sidebar on Desktop)
 */
function initNavigation(activePage) {
  renderSidebar(activePage);
  renderBottomNav(activePage);
}

function renderBottomNav(activePage) {
  const navEl = document.getElementById('bottom-nav');
  if (!navEl) return;

  navEl.innerHTML = '';
  navEl.className = 'bottom-nav';
  navEl.setAttribute('role', 'navigation');
  navEl.setAttribute('aria-label', 'Mobile navigation');

  NAV_DESTINATIONS.forEach((dest) => {
    const link = document.createElement('a');
    link.href = dest.href;
    link.className = 'bottom-nav__item';
    link.id = dest.id + '-mobile';
    link.setAttribute('aria-label', dest.label);

    if (activePage === dest.href) {
      link.classList.add('bottom-nav__item--active');
      link.setAttribute('aria-current', 'page');
    }

    link.innerHTML = `
      <span class="bottom-nav__icon" aria-hidden="true">${dest.icon}</span>
      <span class="bottom-nav__label">${dest.label}</span>
    `;

    navEl.appendChild(link);
  });
}

function renderSidebar(activePage) {
  const sidebarEl = document.getElementById('desktop-sidebar');
  if (!sidebarEl) return;

  sidebarEl.innerHTML = `
    <div class="sidebar__logo">
      <a href="dashboard.html" class="caremate-logo">
        <svg class="caremate-logo__icon" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 35C20 35 7 24 7 13.5C7 8.25 11.25 4 16.5 4C19.5 4 21.5 6 21.5 6" stroke="#3D8B6E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M33 13.5C33 19 28 25 24 29" stroke="#3D8B6E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M28 6C28 6 30.5 4 33 4C35 4 37 6 37 9C37 12 34 14 34 14" stroke="#5BA88A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="20" cy="20" r="1.5" fill="#3D8B6E"/>
        </svg>
        <div class="caremate-logo__text">
          <span class="caremate-logo__name">CareMate</span>
          <span class="caremate-logo__subtitle">Your digital companion</span>
        </div>
      </a>
    </div>

    <div class="sidebar__sos">
      <a href="sos.html" class="sidebar-sos" aria-label="Emergency SOS">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
        <span>Emergency SOS</span>
      </a>
    </div>

    <div class="sidebar__nav">
      <ul class="sidebar-nav">
        ${NAV_DESTINATIONS.map(dest => `
          <li>
            <a href="${dest.href}" class="sidebar-nav__item ${activePage === dest.href ? 'sidebar-nav__item--active' : ''}" ${activePage === dest.href ? 'aria-current="page"' : ''}>
              <span class="sidebar-nav__icon" aria-hidden="true">${dest.icon}</span>
              <span>${dest.label}</span>
            </a>
          </li>
        `).join('')}
      </ul>
    </div>
    
    <div class="sidebar__botanical">
      <svg class="sidebar-botanical" viewBox="0 0 100 150" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M50 150 C50 100 20 80 10 50 C5 30 15 20 25 25 C40 35 45 70 50 100" stroke="#3D8B6E" stroke-width="2" fill="none"/>
        <path d="M50 130 C70 100 90 90 95 60 C98 40 85 30 75 40 C60 55 55 80 50 130" stroke="#3D8B6E" stroke-width="2" fill="none"/>
        <circle cx="20" cy="20" r="3" fill="#3D8B6E"/>
        <circle cx="85" cy="30" r="2" fill="#3D8B6E"/>
        <circle cx="15" cy="45" r="1.5" fill="#3D8B6E"/>
      </svg>
    </div>

    <div class="sidebar__profile">
      <a href="#" class="sidebar-profile">
        <div class="avatar avatar--sm avatar--elderly">A</div>
        <div>
          <div class="sidebar-profile__name" id="sidebar-profile-name">Asha Sharma</div>
          <div class="sidebar-profile__role">View Profile</div>
        </div>
      </a>
    </div>
  `;
}

/**
 * Initialize Global Persistent Header SOS Shortcut (No longer used, handled in sidebar)
 */
function initGlobalSOS() {
  // SOS button is now part of the sidebar HTML and bottom nav
}

/**
 * Global Feedback Component (Section 10 Spec)
 */
function initFeedback() {
  if (document.getElementById('feedback-toast')) return;

  const toast = document.createElement('div');
  toast.id = 'feedback-toast';
  toast.className = 'feedback-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  document.body.appendChild(toast);
}

/**
 * Display Reusable Feedback Toast & Spoken Confirmation
 * @param {object} options - { type: 'success'|'warning'|'error'|'info'|'voice', title, message, speakText, actions }
 */
function showFeedback(options = {}) {
  let toast = document.getElementById('feedback-toast');
  if (!toast) {
    initFeedback();
    toast = document.getElementById('feedback-toast');
  }

  const type = options.type || 'info';
  toast.className = `feedback-toast feedback-toast--${type}`;

  let actionsHTML = '';
  if (options.actions && Array.isArray(options.actions)) {
    actionsHTML = `
      <div style="display: flex; gap: var(--space-8); margin-top: var(--space-8);">
        ${options.actions.map((act, i) => `<button id="toast-act-${i}" class="btn ${act.class || 'btn--primary'}" style="min-height: 48px; padding: 0 var(--space-16); font-size: 16px;">${act.label}</button>`).join('')}
      </div>
    `;
  }

  toast.innerHTML = `
    <div class="feedback-toast__title">
      <span>${type === 'success' ? '✓' : type === 'warning' ? '⚠️' : type === 'error' ? '🔴' : type === 'voice' ? '🎙️' : 'ℹ️'}</span>
      <span>${options.title || 'Notification'}</span>
    </div>
    <div class="feedback-toast__message">${options.message || ''}</div>
    ${actionsHTML}
  `;

  // Bind action buttons if provided
  if (options.actions && Array.isArray(options.actions)) {
    options.actions.forEach((act, i) => {
      const btn = document.getElementById(`toast-act-${i}`);
      if (btn) {
        btn.addEventListener('click', () => {
          toast.classList.remove('feedback-toast--visible');
          if (typeof act.onClick === 'function') act.onClick();
        });
      }
    });
  }

  requestAnimationFrame(() => {
    toast.classList.add('feedback-toast--visible');
  });

  // Speak aloud if voice requested
  if (options.speakText && window.CareMateVoice) {
    window.CareMateVoice.speak(options.speakText);
  }

  // Auto hide unless actions are provided
  if (!options.actions) {
    setTimeout(() => {
      toast.classList.remove('feedback-toast--visible');
    }, 4500);
  }
}

/**
 * Handle page specific initialization logic
 */
function handlePageLoad(activePage) {
  if (activePage === 'reminders.html' && window.Reminders) {
    window.Reminders.loadReminders();
  } else if (activePage === 'appointments.html' && window.Reminders) {
    window.Reminders.loadAppointments();
  } else if (activePage === 'health.html' && window.Health) {
    window.Health.loadHealthRecords();
  } else if (activePage === 'contacts.html') {
    loadContacts();
  }
}

// ── Family Contacts Handlers (Section 23 Spec) ──

function loadContacts(containerId = 'contacts-list') {
  const container = document.getElementById(containerId);
  if (!container) return;

  renderContacts(mockContacts, container);
}

function renderContacts(contacts, container) {
  if (!container) return;

  if (!contacts || contacts.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">👥</div>
        <h4 class="empty-state__title">No emergency contacts</h4>
        <p class="empty-state__description">Add someone who can be notified if you need help.</p>
        <button class="btn btn--primary" onclick="window.scrollTo({ top: 0, behavior: 'smooth' })">+ Add Contact</button>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  contacts.forEach((cnt) => {
    const avatarClass = cnt.relation.includes('Daughter') || cnt.relation.includes('Son') ? 'avatar--contact' : 'avatar--caregiver';
    const initial = cnt.name.charAt(0).toUpperCase();
    
    const card = document.createElement('div');
    card.className = 'contact-card';
    card.innerHTML = `
      <div class="contact-card__header">
        <div class="avatar ${avatarClass}">${initial}</div>
        <div class="contact-card__info">
          <div class="contact-card__name">${cnt.name} <span class="text-sm text-muted">(${cnt.relation})</span></div>
          <div class="contact-card__phone">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            ${cnt.phone}
          </div>
        </div>
        ${cnt.emergencyAlerts ? '<div class="contact-card__badge">Alerts Enabled</div>' : ''}
      </div>
      <div class="contact-card__actions">
        <a href="tel:${cnt.phone}" class="btn btn--sm btn--success">Call</a>
        <button class="btn btn--sm btn--secondary">Edit</button>
        <button class="btn btn--sm btn--ghost" style="color: var(--color-danger);" onclick="CareMateApp.deleteContact('${cnt.id}')">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function addContact(data) {
  const newContact = {
    id: 'c-' + Date.now(),
    name: data.name,
    relation: data.relation || 'Family',
    phone: data.phone,
    emergencyAlerts: data.emergencyAlerts !== false,
  };

  mockContacts.push(newContact);
  loadContacts();

  showFeedback({
    type: 'success',
    title: 'Contact Saved',
    message: `Added ${newContact.name} to your contacts.`,
    speakText: `I've added ${newContact.name} as your contact.`,
  });
}

function deleteContact(id) {
  mockContacts = mockContacts.filter((c) => c.id !== id);
  loadContacts();
}

window.CareMateApp = {
  initApp,
  initNavigation,
  initGlobalSOS,
  initFeedback,
  showFeedback,
  loadContacts,
  renderContacts,
  addContact,
  deleteContact,
};
