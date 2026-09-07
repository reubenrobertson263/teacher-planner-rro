window.router = {
    init() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const route = e.currentTarget.getAttribute('data-route');
                this.loadView(route);
            });
        });
    },

    async loadView(routeName) {
        const root = document.getElementById('app-root');
        if (!root) return;
        
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const activeNav = document.querySelector(`.nav-item[data-route="${routeName}"]`);
        if(activeNav) activeNav.classList.add('active');

        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.remove('open');
        }

        try {
            root.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%;"><i class="fas fa-spinner fa-spin fa-2x" style="color:var(--accent);"></i></div>';
            
            const response = await fetch(`/views/${routeName}.html?t=${Date.now()}`);
            if (!response.ok) throw new Error(`View not found: ${routeName}`);
            
            const html = await response.text();
            root.innerHTML = html;

            // Absolute Traffic Control: Force browser paint before JS execution
            requestAnimationFrame(() => {
                setTimeout(() => this.initViewLogic(routeName), 50);
            });
            
        } catch (error) {
            root.innerHTML = `<div style="padding: 24px; color: #ef4444;"><h3>Error loading view</h3><p>${error.message}</p></div>`;
        }
    },

    initViewLogic(routeName) {
        const controllers = {
            'settings': window.settingsController,
            'timetable': window.timetableController,
            'dashboard': window.dashboardController,
            'planbook': window.planbookController,
            'seating': window.seatingController,
            'markbook': window.markbookController,
            'nametrainer': window.nametrainerController,
            'aistudio': window.aistudioController,
            'tasks': window.tasksController
        };

        if (controllers[routeName] && typeof controllers[routeName].init === 'function') {
            controllers[routeName].init();
        }
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.router.init());
} else {
    window.router.init();
}
