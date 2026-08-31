window.tasksController = {
    tasks: [],
    async init() {
        const res = await fetch('/api/tasks');
        if (res.ok) this.tasks = await res.json();
        this.renderBoard();
    },
    renderBoard() {
        const board = document.getElementById('tasks-masonry-board');
        if (!board) return;
        if (this.tasks.length === 0) {
            board.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 40px;"><i class="fas fa-note-sticky fa-2x"></i><br>No task notes yet. Click "+ New Note" to add one!</div>';
            return;
        }
        board.innerHTML = this.tasks.map(t => `
            <div class="settings-card" style="position:relative; cursor:pointer;" onclick="tasksController.editTask('${t.id}')">
                <button type="button" style="position:absolute; top:12px; right:12px; border:none; background:transparent; color:#ef4444; cursor:pointer;" onclick="event.stopPropagation(); tasksController.deleteTask('${t.id}')"><i class="fas fa-trash"></i></button>
                <h4 style="margin:0 0 8px 0; padding-right:24px;">${t.title}</h4>
                <div style="font-size:0.9em; color:var(--text-muted); line-height:1.4;">Active Task</div>
            </div>
        `).join('');
    },
    openNoteModal() {
        const modal = document.getElementById('note-editor-modal');
        if(modal) {
            document.getElementById('note-modal-title').value = '';
            document.getElementById('note-modal-body').innerHTML = '';
            modal.style.display = 'flex';
        }
    },
    async saveModalNote() {
        const title = document.getElementById('note-modal-title').value.trim();
        if (!title) return;
        await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, status: 'TODO' }) });
        document.getElementById('note-editor-modal').style.display = 'none';
        window.app.showToast("Note Created!");
        this.init();
    },
    async deleteTask(id) {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        this.init();
    }
};
