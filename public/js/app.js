// public/js/app.js
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
    helpMode: false,

    init() {
        this.bootApp();
    },

    async bootApp() {
        const token = localStorage.getItem('flowdesk_token');
        if(!token) {
            document.getElementById('login-overlay').style.display = 'flex';
            document.getElementById('global-loader').style.display = 'none';
            return;
        }

        const savedTheme = localStorage.getItem('flowdesk-theme') || 'light';
        const savedStyle = localStorage.getItem('flowdesk-font-style') || 'standard';
        const savedSize = localStorage.getItem('flowdesk-font-size') || 'standard';
        
        this.changeTheme(savedTheme);
        this.applyFonts(savedStyle, savedSize);

        document.getElementById('global-loader').style.display = 'none';
        
        if (!localStorage.getItem('onboarding_complete')) {
             window.router.loadView('settings');
             // The onboarding modal is shown natively via index.html, 
             // but we ensure they land on the settings page underneath it.
             document.getElementById('onboarding-modal').style.display = 'flex';
        } else {
             window.router.loadView('dashboard');
        }
    },

    showToast(msg) { 
        const t = document.getElementById('toast'); 
        t.querySelector('span').innerText = msg; 
        t.style.opacity = 1; t.style.transform = 'translateY(0) translateX(-50%)'; 
        setTimeout(() => { t.style.opacity = 0; t.style.transform = 'translateY(20px) translateX(-50%)'; }, 2500); 
    },

    toggleMenu() { 
        if (window.innerWidth <= 768) document.getElementById('sidebar').classList.toggle('open'); 
    },

    toggleHelpMode() {
        this.helpMode = !this.helpMode;
        document.body.classList.toggle('help-mode-active', this.helpMode);
        const btn = document.getElementById('help-toggle-btn');
        if (this.helpMode) {
            btn.innerHTML = '<i class="fas fa-times-circle"></i> Disable Help';
            this.showToast("Help tooltips enabled! Hover over the ? icons.");
        } else {
            btn.innerHTML = '<i class="fas fa-question-circle"></i> Enable Help';
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
        document.getElementById('onboarding-modal').style.display = 'none';
        
        // Trigger the Spotlight Tour directly after dismissing the modal
        if (window.settingsController) {
            window.settingsController.startTour();
        } else {
            window.router.loadView('settings').then(() => {
                setTimeout(() => window.settingsController.startTour(), 300);
            });
        }
    },

    changeTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('flowdesk-theme', theme);
    },

    updateFonts() {
        const style = document.getElementById('setting-font-style').value;
        const size = document.getElementById('setting-font-size').value;
        this.applyFonts(style, size);
    },

    applyFonts(style, size) {
        document.body.className = `${style === 'dyslexic' ? 'font-dyslexic' : ''} font-${size}`;
        localStorage.setItem('flowdesk-font-style', style);
        localStorage.setItem('flowdesk-font-size', size);
    }
};
