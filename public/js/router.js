// public/js/router.js
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
        
        // Update Sidebar Active State
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const activeNav = document.querySelector(`.nav-item[data-route="${routeName}"]`);
        if(activeNav) activeNav.classList.add('active');

        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            if (sidebar) sidebar.classList.remove('open');
        }

        try {
            // Show loader while fetching view
            root.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%;"><i class="fas fa-spinner fa-spin fa-2x" style="color:var(--accent);"></i></div>';
            
            // Fetch the external HTML fragment
            const response = await fetch(`/views/${routeName}.html?t=${Date.now()}`);
            if (!response.ok) throw new Error(`View not found: ${routeName}`);
            
            const html = await response.text();
            root.innerHTML = html;

            // Trigger view-specific initialization scripts
            this.initViewLogic(routeName);

        } catch (error) {
            root.innerHTML = `<div style="padding: 24px; color: #ef4444;"><h3>Error loading view</h3><p>${error.message}</p></div>`;
        }
    },

    initViewLogic(routeName) {
        if (routeName === 'settings' && window.settingsController) {
            window.settingsController.init();
        }
        if (routeName === 'timetable' && window.timetableController) {
            window.timetableController.init();
        }
        if (routeName === 'dashboard' && window.dashboardController) {
            window.dashboardController.init();
        }
        if (routeName === 'planbook' && window.planbookController) {
            window.planbookController.init();
        }
    }
};

// Safely initialize the router
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.router.init());
} else {
    window.router.init();
}
