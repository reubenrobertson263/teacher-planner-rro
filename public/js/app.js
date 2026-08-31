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
    init() { this.bootApp(); },
    async bootApp() {
        const loginOverlay = document.getElementById('login-overlay');
        let token = localStorage.getItem('flowdesk_token');

        if (token) {
            try {
                const authCheck = await fetch('/api/user/me');
                if (!authCheck.ok) {
                    localStorage.removeItem('flowdesk_token');
                    token = null;
                } else {
                    const user = await authCheck.json();
                    if(user.isAdmin) {
                        const adminNav = document.getElementById('nav-admin-panel');
                        if(adminNav) adminNav.style.display = 'flex';
                    }
                }
            } catch (e) {
                localStorage.removeItem('flowdesk_token');
                token = null;
            }
        }

        if(!token) {
            if(loginOverlay) loginOverlay.style.display = 'flex';
            return;
        }

        if(loginOverlay) loginOverlay.style.display = 'none';

        // Apply visual settings immediately
        this.changeTheme(localStorage.getItem('flowdesk-theme') || 'light');
        this.applyFonts(localStorage.getItem('flowdesk-font-style') || 'standard', localStorage.getItem('flowdesk-font-size') || 'standard');

        const storedStart = localStorage.getItem('flowdesk-termStart') || "2026-08-31T00:00:00";
        window.termStart = new Date(storedStart);
        if (isNaN(window.termStart)) window.termStart = new Date("2026-08-31T00:00:00");
        
        const storedHols = localStorage.getItem('flowdesk-holidays') || "2026-10-26, 2026-12-21, 2026-12-28, 2027-02-15, 2027-04-05, 2027-04-12, 2027-05-31";
        window.holidays = storedHols.split(',').map(s => s.trim());

        if (!localStorage.getItem('onboarding_complete')) {
             setTimeout(() => {
                 if(window.router) window.router.loadView('settings');
                 const modal = document.getElementById('onboarding-modal');
                 if(modal) { modal.style.display = 'flex'; modal.style.zIndex = '999999'; }
             }, 100);
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
            const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password}) });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error?.message || "Login failed");
            localStorage.setItem('flowdesk_token', data.token);
            if(data.onboarded) localStorage.setItem('onboarding_complete', 'true');
            window.location.reload();
        } catch(e) { alert(e.message); btn.innerHTML = orig; }
    },
    async handleRegister() {
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        const btn = document.getElementById('btn-reg-submit');
        const orig = btn.innerHTML; 
        
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
        btn.disabled = true;
        try {
            const res = await fetch('/api/auth/register', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, email, password}) });
            const data = await res.json();
            if(!res.ok) throw new Error(data.error?.message || "Registration failed");
            localStorage.setItem('flowdesk_token', data.token);
            localStorage.removeItem('onboarding_complete'); 
            
            btn.innerHTML = '<i class="fas fa-check"></i> Success!';
            setTimeout(() => { window.location.reload(); }, 400); // Sped up for ADHD
        } catch(e) { alert(e.message); btn.innerHTML = orig; btn.disabled = false; }
    },
    toggleAuthMode(mode) {
        document.getElementById('login-form').style.display = mode === 'register' ? 'none' : 'block';
        document.getElementById('register-form').style.display = mode === 'register' ? 'block' : 'none';
    },
    showToast(msg) { 
        const t = document.getElementById('toast'); 
        if(!t) return;
        t.querySelector('span').innerText = msg; 
        t.classList.add('show');
        setTimeout(() => { t.classList.remove('show'); }, 2500); 
    },
    dismissOnboarding() {
        localStorage.setItem('onboarding_complete', 'true');
        const modal = document.getElementById('onboarding-modal');
        if(modal) modal.style.display = 'none';
        if (window.settingsController) window.settingsController.startTour();
        else window.router.loadView('settings').then(() => { setTimeout(() => { if(window.settingsController) window.settingsController.startTour(); }, 200); });
    },
    showHelp() {
        localStorage.removeItem('onboarding_complete');
        window.location.reload();
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
    },
    toggleMenu() { 
        if (window.innerWidth <= 768) {
            const sb = document.getElementById('sidebar');
            if(sb) sb.classList.toggle('open');
        }
    }
};

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => window.app.init()); } 
else { window.app.init(); }
