window.tasksController = {
    tasks: [],
    currentEditId: null,

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

        board.innerHTML = this.tasks.map(t => {
            let displayTitle = t.title;
            let displayBody = "";
            if(t.title.includes('|||||')) {
                const parts = t.title.split('|||||');
                displayTitle = parts[0];
                displayBody = parts[1] || "";
            }

            return `
            <div class="settings-card" style="position:relative; cursor:pointer; background:var(--note-bg); border: 1px solid #fde047; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); display:flex; flex-direction:column; max-height: 300px; overflow:hidden;" onclick="tasksController.editTask('${t.id}')">
                <button type="button" style="position:absolute; top:12px; right:12px; border:none; background:transparent; color:#ef4444; cursor:pointer; z-index:10;" onclick="event.stopPropagation(); tasksController.deleteTask('${t.id}')"><i class="fas fa-trash"></i></button>
                <h4 style="margin:0 0 12px 0; padding-right:24px; font-size:1.1em; color:var(--text-main); border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px;">${displayTitle}</h4>
                <div style="font-size:0.9em; color:var(--text-main); line-height:1.5; flex:1; overflow:hidden; text-overflow:ellipsis;">${displayBody || '<span style="opacity:0.5;">Empty note...</span>'}</div>
            </div>
            `;
        }).join('');
    },

    openNoteModal() {
        this.currentEditId = null;
        const modal = document.getElementById('note-editor-modal');
        if(modal) {
            document.getElementById('note-modal-title').value = '';
            document.getElementById('note-modal-body').innerHTML = '';
            modal.style.display = 'flex';
        }
    },

    editTask(id) {
        const task = this.tasks.find(t => t.id === id);
        if(!task) return;
        
        this.currentEditId = id;
        let title = task.title;
        let body = "";
        
        if(task.title.includes('|||||')) {
            const parts = task.title.split('|||||');
            title = parts[0];
            body = parts[1] || "";
        }

        document.getElementById('note-modal-title').value = title;
        document.getElementById('note-modal-body').innerHTML = body;
        document.getElementById('note-editor-modal').style.display = 'flex';
    },

    async saveModalNote() {
        const titleRaw = document.getElementById('note-modal-title').value.trim() || 'Untitled Note';
        const bodyRaw = document.getElementById('note-modal-body').innerHTML;
        
        const serializedPayload = `${titleRaw}|||||${bodyRaw}`;

        if(this.currentEditId) {
            await fetch(`/api/tasks/${this.currentEditId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: serializedPayload })
            });
            window.app.showToast("Note Updated!");
        } else {
            await fetch('/api/tasks', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: serializedPayload, status: 'TODO' })
            });
            window.app.showToast("Note Created!");
        }
        
        document.getElementById('note-editor-modal').style.display = 'none';
        this.init();
    },

    async deleteTask(id) {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        this.init();
    },

    insertLink() {
        const url = prompt("Enter website URL:");
        if (url) document.execCommand('createLink', false, url);
    },

    insertChecklist() {
        document.execCommand('insertHTML', false, `<br><input type="checkbox" style="margin-right:8px;"> List Item<br>`);
    },

    insertImagePlaceholder() {
        const url = prompt("Enter Image URL or type 'placeholder':", "https://via.placeholder.com/300x150");
        if(url) document.execCommand('insertImage', false, url);
    }
};
