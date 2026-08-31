window.appState = {
  blocks: [],
  classes: [],
  rooms: [],
  seatingStudents: [],
  desks: [],
  furniture: [],
  assessments: [],
  tasks: [],
  calendarEvents: [],
  allSeatingPlans: [],
  rawPeriods: []
};

window.idb = {
  db: null,
  namespace: 'anonymous:',

  setUser(userId) {
    this.namespace = userId ? `user:${userId}:` : 'anonymous:';
  },

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('FlowDeskDB', 2);
      req.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('store')) db.createObjectStore('store');
      };
      req.onsuccess = event => {
        this.db = event.target.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  },

  key(key) {
    return `${this.namespace}${key}`;
  },

  async get(key) {
    await this.init();
    return new Promise(resolve => {
      try {
        const tx = this.db.transaction('store', 'readonly');
        const req = tx.objectStore('store').get(this.key(key));
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  },

  async set(key, value) {
    await this.init();
    return new Promise(resolve => {
      try {
        const tx = this.db.transaction('store', 'readwrite');
        tx.objectStore('store').put(value, this.key(key));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  },

  async delete(key) {
    await this.init();
    return new Promise(resolve => {
      try {
        const tx = this.db.transaction('store', 'readwrite');
        tx.objectStore('store').delete(this.key(key));
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) {
        resolve(false);
      }
    });
  }
};

window.flowSync = {
  flushing: false,

  async queue(request) {
    const outbox = await window.idb.get('sync-outbox') || [];
    outbox.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
      ...request
    });
    await window.idb.set('sync-outbox', outbox);
    return true;
  },

  async request(url, options = {}, queueOnFailure = false) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (queueOnFailure && response.status >= 500) await this.queue({ url, options });
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error?.message || `Request failed (${response.status})`);
      }
      return response;
    } catch (error) {
      if (queueOnFailure && (!navigator.onLine || error instanceof TypeError)) {
        await this.queue({ url, options });
        return null;
      }
      throw error;
    }
  },

  async flush() {
    if (this.flushing || !navigator.onLine || !window.app.currentUser) return;
    this.flushing = true;
    try {
      const outbox = await window.idb.get('sync-outbox') || [];
      if (!outbox.length) return;
      const remaining = [];
      for (const item of outbox) {
        try {
          const response = await fetch(item.url, item.options || {});
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              remaining.push(item, ...outbox.slice(outbox.indexOf(item) + 1));
              break;
            }
            remaining.push(item);
          }
        } catch (_) {
          remaining.push(item);
        }
      }
      await window.idb.set('sync-outbox', remaining);
      if (outbox.length && !remaining.length) window.app.showToast('Offline changes synced');
    } finally {
      this.flushing = false;
    }
  }
};

window.app = {
  currentUser: null,
  coreDataReady: null,
  preferenceTimer: null,

  init() {
    this.bootApp();
  },

  async bootApp() {
    const loginOverlay = document.getElementById('login-overlay');
    let user = null;

    try {
      const authCheck = await fetch('/api/user/me', { cache: 'no-store' });
      if (authCheck.ok) user = await authCheck.json();
    } catch (_) {}

    if (!user) {
      this.currentUser = null;
      window.idb.setUser(null);
      if (loginOverlay) loginOverlay.style.display = 'flex';
      return;
    }

    this.currentUser = user;
    window.idb.setUser(user.id);
    if (loginOverlay) loginOverlay.style.display = 'none';

    const adminNav = document.getElementById('nav-admin-panel');
    if (adminNav) adminNav.style.display = user.isAdmin ? 'flex' : 'none';

    this.changeTheme(user.theme || localStorage.getItem('flowdesk-theme') || 'light', false);
    this.applyFonts(
      user.fontStyle || localStorage.getItem('flowdesk-font-style') || 'standard',
      user.fontSize || localStorage.getItem('flowdesk-font-size') || 'standard',
      false
    );

    const storedStart = user.termStart || localStorage.getItem('flowdesk-termStart') || '2026-08-31';
    window.termStart = this.parseLocalDate(storedStart) || this.parseLocalDate('2026-08-31');
    const storedHolidays = user.holidays ?? localStorage.getItem('flowdesk-holidays') ?? '2026-10-26,2026-12-21,2026-12-28,2027-02-15,2027-04-05,2027-04-12,2027-05-31';
    window.holidays = storedHolidays.split(',').map(v => v.trim()).filter(Boolean);
    localStorage.setItem('flowdesk-termStart', this.toDateKey(window.termStart));
    localStorage.setItem('flowdesk-holidays', window.holidays.join(','));

    this.coreDataReady = this.hydrateCoreState();
    await this.coreDataReady;
    this.registerServiceWorker();
    window.addEventListener('online', () => window.flowSync.flush());
    window.flowSync.flush();

    if (!user.onboarded) {
      await window.router.loadView('settings');
      const modal = document.getElementById('onboarding-modal');
      if (modal) modal.style.display = 'flex';
    } else {
      await window.router.loadView('dashboard');
    }
  },

  async hydrateCoreState() {
    const requests = await Promise.allSettled([
      fetch('/api/periods'),
      fetch('/api/classes'),
      fetch('/api/rooms'),
      fetch('/api/timetable')
    ]);
    const [periods, classes, rooms, timetable] = requests;
    if (periods.status === 'fulfilled' && periods.value.ok) window.appState.rawPeriods = await periods.value.json();
    if (classes.status === 'fulfilled' && classes.value.ok) window.appState.classes = await classes.value.json();
    if (rooms.status === 'fulfilled' && rooms.value.ok) window.appState.rooms = await rooms.value.json();
    if (timetable.status === 'fulfilled' && timetable.value.ok) window.appState.blocks = await timetable.value.json();
    return window.appState;
  },

  async handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login-submit');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
    btn.disabled = true;
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Login failed');
      btn.innerHTML = '<i class="fas fa-check"></i> Success';
      window.location.reload();
    } catch (error) {
      alert(error.message);
      btn.innerHTML = original;
      btn.disabled = false;
    }
  },

  async handleRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const btn = document.getElementById('btn-reg-submit');
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
    btn.disabled = true;
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Registration failed');
      btn.innerHTML = '<i class="fas fa-check"></i> Success';
      window.location.reload();
    } catch (error) {
      alert(error.message);
      btn.innerHTML = original;
      btn.disabled = false;
    }
  },

  async logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    window.location.reload();
  },

  toggleAuthMode(mode) {
    const login = document.getElementById('login-form');
    const register = document.getElementById('register-form');
    if (login) login.style.display = mode === 'register' ? 'none' : 'block';
    if (register) register.style.display = mode === 'register' ? 'block' : 'none';
  },

  showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    const label = toast.querySelector('span');
    if (label) label.textContent = message;
    toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  },

  async dismissOnboarding() {
    const modal = document.getElementById('onboarding-modal');
    if (modal) modal.style.display = 'none';
    if (this.currentUser) this.currentUser.onboarded = true;
    fetch('/api/settings/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboarded: true })
    }).catch(() => {});
    if (!document.getElementById('settings-scroll-container')) await window.router.loadView('settings');
    if (window.settingsController) window.settingsController.startTour();
  },

  async showHelp() {
    await window.router.loadView('settings');
    if (window.settingsController) window.settingsController.startTour();
  },

  changeTheme(theme, persist = true) {
    const allowed = ['light', 'dark', 'midnight', 'ocean', 'forest', 'sunset', 'high-contrast'];
    const safeTheme = allowed.includes(theme) ? theme : 'light';
    document.documentElement.setAttribute('data-theme', safeTheme);
    localStorage.setItem('flowdesk-theme', safeTheme);
    if (this.currentUser) this.currentUser.theme = safeTheme;
    if (persist) this.persistPreferences();
  },

  updateFonts() {
    const styleSelect = document.getElementById('setting-font-style');
    const sizeSelect = document.getElementById('setting-font-size');
    if (styleSelect && sizeSelect) this.applyFonts(styleSelect.value, sizeSelect.value, true);
  },

  applyFonts(style, size, persist = true) {
    const safeStyle = style === 'dyslexic' ? 'dyslexic' : 'standard';
    const safeSize = size === 'large' ? 'large' : 'standard';
    document.body.classList.remove('font-standard', 'font-large', 'font-dyslexic');
    document.body.classList.add(`font-${safeSize}`);
    if (safeStyle === 'dyslexic') document.body.classList.add('font-dyslexic');
    localStorage.setItem('flowdesk-font-style', safeStyle);
    localStorage.setItem('flowdesk-font-size', safeSize);
    if (this.currentUser) {
      this.currentUser.fontStyle = safeStyle;
      this.currentUser.fontSize = safeSize;
    }
    if (persist) this.persistPreferences();
  },

  persistPreferences() {
    clearTimeout(this.preferenceTimer);
    this.preferenceTimer = setTimeout(() => {
      if (!this.currentUser) return;
      fetch('/api/settings/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: this.currentUser.theme,
          fontStyle: this.currentUser.fontStyle,
          fontSize: this.currentUser.fontSize
        })
      }).catch(() => {});
    }, 250);
  },

  toggleMenu() {
    if (window.innerWidth <= 900) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    }
  },

  escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  },

  stripMarkdownUrl(value) {
    const raw = String(value || '').trim();
    const markdown = raw.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
    return markdown ? markdown[1] : raw.replace(/^<|>$/g, '');
  },

  parseLocalDate(value) {
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  },

  toDateKey(date) {
    const d = date instanceof Date ? date : this.parseLocalDate(date);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try { await navigator.serviceWorker.register('/sw.js'); } catch (error) { console.warn('Service worker registration failed', error); }
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.app.init(), { once: true });
} else {
  window.app.init();
}
