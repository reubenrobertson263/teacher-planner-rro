window.router = {
  routeSequence: 0,
  currentRoute: null,
  hashHandlerBound: false,
  validRoutes: new Set(['settings', 'timetable', 'dashboard', 'planbook', 'seating', 'markbook', 'nametrainer', 'aistudio', 'tasks', 'admin']),

  init() {
    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.dataset.routerBound === 'true') return;
      item.dataset.routerBound = 'true';
      item.addEventListener('click', event => {
        const route = event.currentTarget.getAttribute('data-route');
        if (route) this.loadView(route);
      });
    });

    if (!this.hashHandlerBound) {
      this.hashHandlerBound = true;
      window.addEventListener('hashchange', async () => {
        if (!window.app?.currentUser) return;
        const route = this.getRouteFromHash() || 'dashboard';
        await this.loadView(route, { syncHash: false });
      });
    }
  },

  getRouteFromHash() {
    const route = String(window.location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();
    return this.validRoutes.has(route) ? route : null;
  },

  syncRouteHash(routeName, replaceHistory = false) {
    const nextHash = `#${routeName}`;
    if (window.location.hash === nextHash) return;
    const url = `${window.location.pathname}${window.location.search}${nextHash}`;
    if (replaceHistory) window.history.replaceState({ route: routeName }, '', url);
    else window.history.pushState({ route: routeName }, '', url);
  },

  async loadView(routeName, options = {}) {
    const safeRoute = this.validRoutes.has(routeName) ? routeName : 'dashboard';
    const root = document.getElementById('app-root');
    if (!root || !window.app?.currentUser) return;
    const sequence = ++this.routeSequence;

    if (options.syncHash !== false) this.syncRouteHash(safeRoute, !!options.replaceHistory);

    const previousController = this.getController(this.currentRoute);
    if (previousController && typeof previousController.destroy === 'function') {
      try { await previousController.destroy(); } catch (error) { console.warn(error); }
    }
    if (sequence !== this.routeSequence) return;

    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-route="${safeRoute}"]`);
    if (activeNav) activeNav.classList.add('active');

    if (window.innerWidth <= 900) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.remove('open');
    }

    root.innerHTML = '<div class="route-loader"><i class="fas fa-spinner fa-spin fa-2x" aria-hidden="true"></i><span>Loading FlowDesk…</span></div>';

    try {
      const response = await fetch(`/views/${safeRoute}.html`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`View not found: ${safeRoute}`);
      const html = await response.text();
      if (sequence !== this.routeSequence) return;

      // Critical SPA barrier: every route waits for one serialized, atomic global hydration
      // before any view controller can read or mutate shared state.
      await window.app.loadGlobalData();
      if (sequence !== this.routeSequence) return;

      root.innerHTML = html;
      this.currentRoute = safeRoute;

      await new Promise(resolve => requestAnimationFrame(resolve));
      if (sequence !== this.routeSequence) return;
      await this.initViewLogic(safeRoute);
    } catch (error) {
      if (sequence !== this.routeSequence) return;
      console.error(error);
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
