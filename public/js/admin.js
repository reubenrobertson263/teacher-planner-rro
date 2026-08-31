window.adminController = {
  users: [],
  async init() { await this.loadUsers(); },
  async loadUsers() {
    const list = document.getElementById('admin-user-list');
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 403 ? 'Admin access required.' : 'Could not load users.');
      this.users = await response.json(); this.renderUsers();
    } catch (error) { if (list) list.textContent = error.message; }
  },
  renderUsers() {
    const list = document.getElementById('admin-user-list'); if (!list) return;
    list.innerHTML = '';
    this.users.forEach(user => {
      const row = document.createElement('div'); row.className = 'admin-user-row';
      row.innerHTML = `<div><strong>${window.app.escapeHTML(user.name)}</strong>${user.isAdmin ? ' <span class="admin-badge">Admin</span>' : ''}<small>${window.app.escapeHTML(user.email)}</small></div><button type="button" class="btn-outline">Reset Password</button>`;
      row.querySelector('button').addEventListener('click', () => this.resetPassword(user.id, user.email)); list.appendChild(row);
    });
  },
  async resetPassword(userId, email) {
    const password = prompt(`Enter a new password for ${email}:`); if (!password) return;
    if (password.length < 8) return window.app.showToast('Password must contain at least 8 characters.', 'error');
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return window.app.showToast(data?.error?.message || 'Password reset failed.', 'error');
    window.app.showToast(`Password reset for ${email}.`);
  },
  async nukeDatabase(button) {
    if (prompt("Type WIPE to confirm deletion of all FlowDesk application data. User accounts are preserved.") !== 'WIPE') return;
    const original = button.innerHTML; button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wiping…';
    try {
      const response = await fetch('/api/admin/wipe', { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Database wipe failed.');
      await Promise.all([
        window.idb.set('wholeSchoolRoster', []), window.idb.delete('nt_progress'), window.idb.delete('sync-outbox'), window.idb.delete('rosterVersion')
      ]);
      localStorage.removeItem('pinnedClasses'); localStorage.removeItem('flowdeskTimetableCustomElements');
      window.appState.blocks = []; window.appState.classes = []; window.appState.rooms = []; window.appState.rawPeriods = [];
      window.app.showToast('Application data wiped; user accounts preserved.');
      await window.app.hydrateCoreState();
      await this.loadUsers();
    } catch (error) { window.app.showToast(error.message, 'error'); }
    finally { button.disabled = false; button.innerHTML = original; }
  }
};
