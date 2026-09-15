window.tasksController = {
    tasks: [],
    currentEditId: null,
    savedRange: null,

    async init() {
        const res = await fetch('/api/tasks');
        if (res.ok) this.tasks = await res.json();
        this.renderBoard();
        this.bindModalCheckboxHandler();
    },

    bindModalCheckboxHandler() {
        const editor = document.getElementById('note-modal-body');
        if (!editor || editor.dataset.checkBound) return;
        editor.dataset.checkBound = 'true';

        editor.addEventListener('click', (e) => {
            const cb = e.target.closest('input[type="checkbox"]');
            if (cb) {
                if (cb.checked) {
                    cb.setAttribute('checked', 'checked');
                    cb.closest('.checklist-item')?.classList.add('checked');
                } else {
                    cb.removeAttribute('checked');
                    cb.closest('.checklist-item')?.classList.remove('checked');
                }
            }
        });
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
            <div class="settings-card" style="position:relative; cursor:pointer; background:var(--note-bg); border: 1px solid #fde047; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); display:flex; flex-direction:column; max-height: 320px; overflow:hidden;" onclick="tasksController.editTask('${t.id}')">
                <button type="button" style="position:absolute; top:12px; right:12px; border:none; background:transparent; color:#ef4444; cursor:pointer; z-index:10;" onclick="event.stopPropagation(); tasksController.deleteTask('${t.id}')"><i class="fas fa-trash"></i></button>
                <h4 style="margin:0 0 12px 0; padding-right:24px; font-size:1.1em; color:var(--text-main); border-bottom:1px solid rgba(0,0,0,0.05); padding-bottom:8px;">${displayTitle}</h4>
                <div style="font-size:0.9em; color:var(--text-main); line-height:1.5; flex:1; overflow:hidden; text-overflow:ellipsis;">${displayBody || '<span style="opacity:0.5;">Empty note...</span>'}</div>
                <div style="font-size:0.72em; color:var(--text-muted); margin-top:12px; padding-top:8px; border-top:1px solid rgba(0,0,0,0.05);"><i class="far fa-clock"></i> ${new Date(t.createdAt).toLocaleString()}</div>
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
            const heading = document.getElementById('note-modal-heading');
            if (heading) heading.textContent = 'New Note';
            modal.style.display = 'flex';
        }
    },

    closeModal() {
        const modal = document.getElementById('note-editor-modal');
        if (modal) modal.style.display = 'none';
        this.currentEditId = null;
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
        const heading = document.getElementById('note-modal-heading');
        if (heading) heading.textContent = 'Edit Note';
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

    command(command, value = null) {
        const editor = document.getElementById('note-modal-body');
        if (editor) editor.focus();
        document.execCommand(command, false, value);
    },

    openHighlighter(button) {
        const sel = window.getSelection();
        if (sel?.rangeCount) this.savedRange = sel.getRangeAt(0).cloneRange();

        document.querySelectorAll('.highlighter-palette-pop').forEach(p => p.remove());

        const palette = document.createElement('div');
        palette.className = 'highlighter-palette-pop';
        palette.style.cssText = 'position:fixed; z-index:999999; background:var(--card); border:1px solid var(--border); border-radius:10px; padding:6px; box-shadow:var(--shadow-md); display:flex; gap:6px; align-items:center;';

        const colors = [
          { color: '#fef08a', name: 'Yellow' },
          { color: '#bbf7d0', name: 'Green' },
          { color: '#bae6fd', name: 'Blue' },
          { color: '#fbcfe8', name: 'Pink' },
          { color: '#fed7aa', name: 'Orange' },
          { color: 'transparent', name: 'Clear' }
        ];

        colors.forEach(item => {
          const swatch = document.createElement('button');
          swatch.type = 'button';
          swatch.title = item.name;
          swatch.style.cssText = `width:22px; height:22px; border-radius:50%; border:1px solid rgba(0,0,0,0.15); background:${item.color === 'transparent' ? '#fff' : item.color}; cursor:pointer; position:relative;`;
          if (item.color === 'transparent') swatch.innerHTML = '<span style="color:#ef4444; font-size:11px; font-weight:bold; line-height:22px; display:block;">✕</span>';

          swatch.addEventListener('mousedown', (e) => e.preventDefault());
          swatch.addEventListener('click', () => {
            const editor = document.getElementById('note-modal-body');
            editor.focus();
            const currentSel = window.getSelection();
            if (this.savedRange) {
              currentSel.removeAllRanges();
              currentSel.addRange(this.savedRange);
            }
            document.execCommand('hiliteColor', false, item.color);
            palette.remove();
          });
          palette.appendChild(swatch);
        });

        document.body.appendChild(palette);
        const rect = button.getBoundingClientRect();
        palette.style.top = `${rect.bottom + 6}px`;
        palette.style.left = `${Math.max(10, rect.left - 20)}px`;

        const closeHandler = (e) => {
          if (!palette.contains(e.target) && e.target !== button) {
            palette.remove();
            document.removeEventListener('click', closeHandler);
          }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    },

    insertLink() {
        const url = prompt("Enter website URL:");
        if (url) document.execCommand('createLink', false, url);
    },

    insertChecklist() {
        const html = `<div class="checklist-item" style="display:flex; align-items:center; gap:8px; margin:4px 0;"><input type="checkbox" contenteditable="false" style="width:16px; height:16px; cursor:pointer; accent-color:var(--accent);"> <span>List item...</span></div><div><br></div>`;
        const editor = document.getElementById('note-modal-body');
        editor.focus();
        document.execCommand('insertHTML', false, html);
    },

    uploadImage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;
            if (file.size > 8 * 1024 * 1024) return window.app.showToast('Image is too large (max 8MB).', 'error');
            const reader = new FileReader();
            reader.onload = (e) => {
                const html = `<div style="margin:8px 0;"><img src="${e.target.result}" style="max-width:100%; height:auto; border-radius:8px; border:1px solid var(--border);" alt="Uploaded note image" /></div><div><br></div>`;
                const editor = document.getElementById('note-modal-body');
                editor.focus();
                document.execCommand('insertHTML', false, html);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }
};
