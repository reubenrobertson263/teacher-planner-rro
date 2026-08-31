window.appState = { blocks: [], classes: [], rooms: [], seatingStudents: [], desks: [], furniture: [], assessments: [], tasks: [], calendarEvents: [], allSeatingPlans: [], rawPeriods: [] };

window.idb = {
    db: null,
    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('FlowDeskDB', 1);
            req.onupgradeneeded = e => { e.target.result.createObjectStore('store'); };
            req.onsuccess = e => { this.db = e.target.result; resolve(); };
            req.onerror = e => reject(e);
        });
    },
    async get(key) {
        if(!this.db) await this.init();
        return new Promise(resolve => {
            try {
                const tx = this.db.transaction('store', 'readonly');
                const req = tx.objectStore('store').get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch(e) { resolve(null); }
        });
    },
    async set(key, val) {
        if(!this.db) await this.init();
        return new Promise(resolve => {
            try {
                const tx = this.db.transaction('store', 'readwrite');
                tx.objectStore('store').put(val, key);
                tx.oncomplete = () => resolve();
            } catch(e) { resolve(); }
        });
    }
};

window.app = {
    init() {
        this.bootApp();
    },

    async bootApp() {
        const loginOverlay = document.getElementById('login-overlay');
        let token = localStorage.getItem('flowdesk_token');

        // ARCHITECTURAL FIX: Verify backend session cookie before trusting frontend local storage token
        // This eliminates the ghost session race condition on browser hard resets.
        if (token) {
            try {
                const authCheck = await fetch('/api/user/me');
                if (!authCheck.ok) {
                    // Backend session is dead. Clear ghost token.
                    localStorage.removeItem('flowdesk_token');
                    token = null;
                }
            } catch (e) {
                // Network error, fail securely.
                localStorage.removeItem('flowdesk_token');
                token = null;
            }
        }

        // If no valid session exists, force the login screen
        if(!token) {
            if(loginOverlay) loginOverlay.style.display = 'flex';
            const loader = document.getElementById('global-loader');
            if (loader) loader.style.display = 'none';
            return;
        }

        // Valid session confirmed. Mount UI.
        if(loginOverlay) loginOverlay.style.display = 'none';

        const savedTheme = localStorage.getItem('flowdesk-theme') || 'light';
        const savedStyle = localStorage.getItem('flowdesk-font-style') || 'standard';
        const savedSize = localStorage.getItem('flowdesk-font-size') || 'standard';
        this.changeTheme(savedTheme);
        this.applyFonts(savedStyle, savedSize);

        const storedStart = localStorage.getItem('flowdesk-termStart') || "2026-08-31T00:00:00";
        window.termStart = new Date(storedStart);
        if (isNaN(window.termStart)) window.termStart = new Date("2026-08-31T00:00:00");
        
        const storedHols = localStorage.getItem('flowdesk-holidays') || "2026-10-26, 2026-12-21, 2026-12-28, 2027-02-15, 2027-04-05, 2027-04-12, 2027-05-31";
        window.holidays = storedHols.split(',').map(s => s.trim());

        if (!localStorage.getItem('onboarding_complete')) {
             if(window.router) window.router.loadView('settings');
             const modal = document.getElementById('onboarding-modal');
             if(modal) modal.style.display = 'flex';
        } else {
             if(window.router) window.router.loadView('dashboard');
        }
    },

    async handleLogin() {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const btn = document.getElementById('btn-login-submit');
        const orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({email, password})
            });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error?.message || "Login failed");
            
            localStorage.setItem('flowdesk_token', data.token);
            if(data.onboarded) localStorage.setItem('onboarding_complete', 'true');
            window.location.reload();
        } catch(e) {
            alert(e.message);
            btn.innerHTML = orig;
        }
    },

    async handleRegister() {
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        const btn = document.getElementById('btn-reg-submit');
        const orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name, email, password})
            });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error?.message || "Registration failed");
            
            localStorage.setItem('flowdesk_token', data.token);
            window.location.reload();
        } catch(e) {
            alert(e.message);
            btn.innerHTML = orig;
        }
    },

    toggleAuthMode(mode) {
        if(mode === 'register') {
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
        } else {
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
        }
    },

    showToast(msg) { 
        const t = document.getElementById('toast'); 
        if(!t) return;
        t.querySelector('span').innerText = msg; 
        t.style.opacity = 1; t.style.transform = 'translateY(0) translateX(-50%)'; 
        setTimeout(() => { t.style.opacity = 0; t.style.transform = 'translateY(20px) translateX(-50%)'; }, 2500); 
    },

    toggleMenu() { 
        if (window.innerWidth <= 768) {
            const sb = document.getElementById('sidebar');
            if(sb) sb.classList.toggle('open');
        }
    },

    dismissOnboarding() {
        localStorage.setItem('onboarding_complete', 'true');
        const modal = document.getElementById('onboarding-modal');
        if(modal) modal.style.display = 'none';
        
        if (window.settingsController) {
            window.settingsController.startTour();
        } else {
            window.router.loadView('settings').then(() => {
                setTimeout(() => {
                    if(window.settingsController) window.settingsController.startTour();
                }, 300);
            });
        }
    },

    changeTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('flowdesk-theme', theme);
    },

    updateFonts() {
        const styleSel = document.getElementById('setting-font-style');
        const sizeSel = document.getElementById('setting-font-size');
        if(styleSel && sizeSel) this.applyFonts(styleSel.value, sizeSel.value);
    },

    applyFonts(style, size) {
        document.body.className = `${style === 'dyslexic' ? 'font-dyslexic' : ''} font-${size}`;
        localStorage.setItem('flowdesk-font-style', style);
        localStorage.setItem('flowdesk-font-size', size);
    }
};

// THE IGNITION SWITCH
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.app.init());
} else {
    window.app.init();
}
