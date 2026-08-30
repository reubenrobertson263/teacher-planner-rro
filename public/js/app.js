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
        const token = localStorage.getItem('flowdesk_token');
        if(!token) {
            document.getElementById('login-overlay').style.display = 'flex';
            const loader = document.getElementById('global-loader');
            if(loader) loader.style.display = 'none';
            return;
        }

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

        const loader = document.getElementById('global-loader');
        if(loader) loader.style.display = 'none';
        
        if (!localStorage.getItem('onboarding_complete')) {
             window.router.loadView('settings');
             const modal = document.getElementById('onboarding-modal');
             if(modal) modal.style.display = 'flex';
        } else {
             window.router.loadView('dashboard');
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

    toggleAuthMode(mode) {
        if(mode === 'register') {
            document.getElementById('login-form').style.display = 'none';
            document.getElementById('register-form').style.display = 'block';
        } else {
            document.getElementById('register-form').style.display = 'none';
            document.getElementById('login-form').style.display = 'block';
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
