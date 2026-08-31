window.tasksController = {
  tasks: [], currentEditId: null,

  escapeHTML(value) {
    if (window.app && typeof window.app.escapeHTML === 'function') return window.app.escapeHTML(value);
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
  },

  async init() {
    const response = await fetch('/api/tasks', { cache: 'no-store' });
    if (!response.ok) return window.app.showToast('Could not load notes.', 'error');
    this.tasks = await response.json();
    this.renderBoard();
  },

  unpackLegacy(task) {
    if (task.notes != null && task.notes !== '') return { title: task.title, notes: task.notes };
    if (String(task.title || '').includes('|||||')) {
      const index = task.title.indexOf('|||||');
      return { title: task.title.slice(0, index), notes: task.title.slice(index + 5) };
    }
    return { title: task.title || '', notes: task.notes || '' };
  },

  formatTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${time} - ${day}`;
  },

  renderBoard() {
    const board = document.getElementById('tasks-masonry-board'); if (!board) return;
    if (!this.tasks.length) {
      board.innerHTML = '<div class="notes-empty"><i class="fas fa-note-sticky fa-2x"></i><strong>No task notes yet</strong><span>Choose “New Note” to create your first sticky.</span></div>';
      return;
    }
    board.innerHTML = '';
    this.tasks.forEach(task => {
      const data = this.unpackLegacy(task);
      const card = document.createElement('article'); card.className = 'sticky-note-card'; card.tabIndex = 0;
      card.innerHTML = `<button type="button" class="sticky-delete" aria-label="Delete note"><i class="fas fa-trash"></i></button><h3>${this.escapeHTML(data.title)}</h3><div class="sticky-body">${data.notes || '<span class="sticky-placeholder">Empty note…</span>'}</div><footer><i class="far fa-clock"></i> ${this.escapeHTML(this.formatTimestamp(task.clientCreatedAt || task.createdAt))}</footer>`;
      card.addEventListener('click', () => this.editTask(task.id));
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.editTask(task.id); } });
      card.querySelector('.sticky-delete').addEventListener('click', event => { event.stopPropagation(); this.deleteTask(task.id); });
      board.appendChild(card);
    });
  },

  openNoteModal() {
    this.currentEditId = null;
    document.getElementById('note-modal-title').value = '';
    document.getElementById('note-modal-body').innerHTML = '';
    document.getElementById('note-modal-heading').textContent = 'New Note';
    document.getElementById('note-editor-modal').style.display = 'flex';
    document.getElementById('note-modal-title').focus();
  },

  closeModal() { document.getElementById('note-editor-modal').style.display = 'none'; this.currentEditId = null; },

  editTask(id) {
    const task = this.tasks.find(item => item.id === id); if (!task) return;
    const data = this.unpackLegacy(task);
    this.currentEditId = id;
    document.getElementById('note-modal-title').value = data.title;
    document.getElementById('note-modal-body').innerHTML = data.notes || '';
    document.getElementById('note-modal-heading').textContent = 'Edit Note';
    document.getElementById('note-editor-modal').style.display = 'flex';
    this.syncChecklistAttributes();
  },

  async saveModalNote() {
    const title = document.getElementById('note-modal-title').value.trim();
    const body = document.getElementById('note-modal-body');
    if (!title) return window.app.showToast('Title required.', 'error');
    this.syncChecklistAttributes();
    const payload = { title, notes: body.innerHTML, status: 'TODO' };
    const editing = !!this.currentEditId;
    if (!editing) payload.clientCreatedAt = new Date().toISOString();
    const url = editing ? `/api/tasks/${encodeURIComponent(this.currentEditId)}` : '/api/tasks';
    const method = editing ? 'PUT' : 'POST';
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Could not save note');
      this.closeModal();
      window.app.showToast(editing ? 'Note updated.' : 'Note created.');
      await this.init();
    } catch (error) { window.app.showToast(error.message, 'error'); }
  },

  async deleteTask(id) {
    if (!confirm('Delete this note?')) return;
    const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) return window.app.showToast('Could not delete note.', 'error');
    await this.init();
  },

  editor() { return document.getElementById('note-modal-body'); },

  command(command, value = null) {
    this.editor()?.focus();
    document.execCommand(command, false, value);
  },

  insertLink() {
    const raw = prompt('Enter website URL:'); if (!raw) return;
    const url = window.app.stripMarkdownUrl(raw);
    if (!/^https?:\/\//i.test(url)) return window.app.showToast('Enter a valid http(s) URL.', 'error');
    this.command('createLink', url);
    const selection = window.getSelection();
    const anchor = selection?.anchorNode?.parentElement?.closest?.('a');
    if (anchor) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
  },

  insertChecklist() {
    const id = `check-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.command('insertHTML', `<div><input type="checkbox" data-placeholder="${id}"> <span>Checklist item</span></div>`);
    this.syncChecklistAttributes();
  },

  syncChecklistAttributes() {
    this.editor()?.querySelectorAll('input[type="checkbox"]').forEach(box => {
      box.onchange = () => { if (box.checked) box.setAttribute('checked', 'checked'); else box.removeAttribute('checked'); };
      if (box.hasAttribute('checked')) box.checked = true;
    });
  },

  insertImagePlaceholder() {
    const label = prompt('Describe the image/resource placeholder:', 'Insert image here');
    if (!label) return;
    this.command('insertHTML', `<div class="note-image-placeholder" data-placeholder="image"><i class="fas fa-image"></i><span>${this.escapeHTML(label)}</span></div><p><br></p>`);
  }
};
