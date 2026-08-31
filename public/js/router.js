window.router = {
  routeSequence: 0,
  currentRoute: null,

  init() {
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.dataset.routerBound === 'true') return;
      item.dataset.routerBound = 'true';
      item.addEventListener('click', event => {
        const route = event.currentTarget.getAttribute('data-route');
        if (route) this.loadView(route);
      });
    });
  },

  async loadView(routeName) {
    const root = document.getElementById('app-root');
    if (!root) return;
    const sequence = ++this.routeSequence;

    const previousController = this.getController(this.currentRoute);
    if (previousController && typeof previousController.destroy === 'function') {
      try { await previousController.destroy(); } catch (error) { console.warn(error); }
    }

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-route="${routeName}"]`);
    if (activeNav) activeNav.classList.add('active');

    if (window.innerWidth <= 900) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.remove('open');
    }

    root.innerHTML = '<div class="route-loader"><i class="fas fa-spinner fa-spin fa-2x"></i><span>Loading FlowDesk…</span></div>';

    try {
      const response = await fetch(`/views/${routeName}.html`);
      if (!response.ok) throw new Error(`View not found: ${routeName}`);
      const html = await response.text();
      if (sequence !== this.routeSequence) return;
      root.innerHTML = html;
      this.currentRoute = routeName;

      // The view is now in the DOM. Wait for one paint before running view-specific initialisers.
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (sequence !== this.routeSequence) return;
      await this.initViewLogic(routeName);
    } catch (error) {
      if (sequence !== this.routeSequence) return;
      root.innerHTML = `<div class="route-error"><h3>Unable to load this view</h3><p>${window.app.escapeHTML(error.message)}</p></div>`;
    }
  },

  getController(routeName) {
    const controllers = {
      settings: window.settingsController,
      timetable: window.timetableController,
      dashboard: window.dashboardController,
      planbook: window.planbookController,
      seating: window.seatingController,
      markbook: window.markbookController,
      nametrainer: window.nametrainerController,
      aistudio: window.aistudioController,
      tasks: window.tasksController,
      admin: window.adminController
    };
    return controllers[routeName] || null;
  },

  async initViewLogic(routeName) {
    const controller = this.getController(routeName);
    if (controller && typeof controller.init === 'function') await controller.init();
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.router.init(), { once: true });
} else {
  window.router.init();
}
