window.adminController = {
    users: [],
    async init() { await this.loadUsers(); },
    async loadUsers() {
        try {
            const res = await fetch('/api/admin/users');
            if (res.ok) {
                this.users = await res.json();
                this.renderUsers();
            } else {
                document.getElementById('admin-user-list').innerHTML = '<div style="color:#ef4444;">Unauthorized. You are not an admin.</div>';
            }
        } catch (e) { console.error(e); }
    },
    renderUsers() {
        const list = document.getElementById('admin-user-list');
        if (!list) return;
        if (this.users.length === 0) return list.innerHTML = '<div>No users found.</div>';
        list.innerHTML = this.users.map(u => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--note-bg); padding:12px; border:1px solid var(--border); border-radius:var(--radius-sm);">
                <div>
                    <div style="font-weight:700;">${u.name} ${u.isAdmin ? '<span style="color:#ef4444; font-size:0.8em;">(Admin)</span>' : ''}</div>
                    <div style="font-size:0.85em; color:var(--text-muted);">${u.email}</div>
                </div>
                <div><button class="btn-outline" style="font-size:0.8em;" onclick="adminController.resetPassword('${u.id}', '${u.email}')">Reset Password</button></div>
            </div>`).join('');
    },
    async resetPassword(userId, email) {
        const newPass = prompt(`Enter new password for ${email}:`);
        if (!newPass) return;
        try {
            const res = await fetch(`/api/admin/users/${userId}/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: newPass }) });
            if (res.ok) window.app.showToast(`Password for ${email} reset successfully.`);
            else alert("Failed to reset password.");
        } catch (e) { alert(e.message); }
    },
    async nukeDatabase(btn) {
        const check1 = prompt("Type 'WIPE' to confirm complete database destruction.");
        if (check1 !== 'WIPE') return;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> WIPING DATABASES...';
        btn.disabled = true;
        try {
            const res = await fetch('/api/admin/wipe', { method: 'POST' });
            if (res.ok) {
                btn.innerHTML = '<i class="fas fa-check"></i> DATABASE ANNIHILATED';
                window.app.showToast("All databases wiped.");
                setTimeout(() => { localStorage.clear(); window.location.reload(); }, 1500);
            } else throw new Error("Wipe failed.");
        } catch (e) { alert(e.message); btn.innerHTML = orig; btn.disabled = false; }
    }
};
