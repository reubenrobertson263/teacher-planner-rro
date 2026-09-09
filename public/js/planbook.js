window.planbookController = {
  currentDate: new Date(),
  viewMode: 'week',
  blocks: [], classes: [], periods: [], lessons: [], notes: [],
  saveTimers: new Map(), pendingSaves: new Map(), renderSequence: 0,

  async init() {
    await this.loadCoreData();
    this.currentDate = new Date();
    this.viewMode = 'week';
    document.getElementById('btn-view-day')?.classList.remove('active');
    document.getElementById('btn-view-week')?.classList.add('active');
    await this.render({ instant: false });
  },

  async destroy() {
    await this.flushPendingSaves();
  },

  async loadCoreData() {
    if (!window.appState.globalHydrated) throw new Error('Planbook global data is not hydrated.');
    this.periods = (window.appState.rawPeriods || []).slice();
    this.classes = (window.appState.classes || []).slice();
    this.blocks = (window.appState.blocks || []).slice();
  },

  orderedPeriods() {
    return this.periods.slice().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  },

  periodNumber(period, index) {
    return Number(period.sortOrder || (index + 1));
  },

  getMonday(value) {
    const d = new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return d;
  },

  dateKey(value) { return window.app.toDateKey(value); },

  holidayDateSet() { return new Set((window.holidays || []).map(String)); },

  holidayWeekMondaySet() {
    const set = new Set();
    (window.holidays || []).forEach(key => {
      const date = window.app.parseLocalDate(key);
      if (date && date.getDay() === 1) set.add(this.dateKey(date));
    });
    return set;
  },

  isHolidayDate(date) {
    const exact = this.holidayDateSet();
    if (exact.has(this.dateKey(date))) return true;
    return this.holidayWeekMondaySet().has(this.dateKey(this.getMonday(date)));
  },

  getWeekType(date = this.currentDate) {
    const cycleStart = this.getMonday(window.termStart || new Date(2026, 7, 31));
    const targetMonday = this.getMonday(date);
    if (targetMonday < cycleStart) return 'A';
    const skipped = this.holidayWeekMondaySet();
    let activeWeeks = 0;
    const cursor = new Date(cycleStart);
    while (cursor < targetMonday) {
      if (!skipped.has(this.dateKey(cursor))) activeWeeks += 1;
      cursor.setDate(cursor.getDate() + 7);
    }
    return activeWeeks % 2 === 0 ? 'A' : 'B';
  },

  async setView(mode) {
    this.viewMode = mode === 'day' ? 'day' : 'week';
    document.getElementById('btn-view-day')?.classList.toggle('active', this.viewMode === 'day');
    document.getElementById('btn-view-week')?.classList.toggle('active', this.viewMode === 'week');
    await this.render({ instant: true });
  },

  async navigate(direction) {
    void this.flushPendingSaves();
    this.currentDate = new Date(this.currentDate);
    this.currentDate.setDate(this.currentDate.getDate() + Number(direction) * (this.viewMode === 'day' ? 1 : 7));
    await this.render({ instant: true });
  },

  async goToday() {
    void this.flushPendingSaves();
    this.currentDate = new Date();
    await this.render({ instant: true });
  },

  async render({ instant = false } = {}) {
    const sequence = ++this.renderSequence;
    const range = this.visibleRange();

    if (instant) {
      await this.renderCurrentView();
      void this.refreshPlanningData(range, sequence);
      return;
    }

    await this.loadPlanningData(range.from, range.to);
    if (sequence !== this.renderSequence) return;
    await this.renderCurrentView();
  },

  async renderCurrentView() {
    if (this.viewMode === 'day') await this.renderDayView();
    else await this.renderWeekView();
  },

  async refreshPlanningData(range, sequence) {
    try {
      await this.loadPlanningData(range.from, range.to);
      if (sequence !== this.renderSequence) return;
      await this.renderCurrentView();
    } catch (error) {
      console.warn('Planbook background refresh failed; local view retained.', error);
    }
  },

  visibleRange() {
    if (this.viewMode === 'day') {
      const key = this.dateKey(this.currentDate);
      return { from: key, to: key };
    }
    const mon = this.getMonday(this.currentDate);
    const fri = new Date(mon); fri.setDate(fri.getDate() + 4);
    return { from: this.dateKey(mon), to: this.dateKey(fri) };
  },

  async loadPlanningData(from, to) {
    const [lessonsRes, notesRes] = await Promise.all([
      fetch(`/api/lessons?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      fetch(`/api/notes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    ]);
    const fetchedLessons = lessonsRes.ok ? await lessonsRes.json() : [];
    const fetchedNotes = notesRes.ok ? await notesRes.json() : [];

    const lessonMap = new Map(this.lessons.map(item => [`${this.dateKey(new Date(item.date))}:${Number(item.period)}`, item]));
    fetchedLessons.forEach(item => lessonMap.set(`${this.dateKey(new Date(item.date))}:${Number(item.period)}`, item));
    this.lessons = [...lessonMap.values()];

    const noteMap = new Map(this.notes.map(item => [this.dateKey(new Date(item.date)), item]));
    fetchedNotes.forEach(item => noteMap.set(this.dateKey(new Date(item.date)), item));
    this.notes = [...noteMap.values()];
  },

  lessonFor(dateKey, period) {
    return this.lessons.find(item => this.dateKey(new Date(item.date)) === dateKey && Number(item.period) === Number(period));
  },

  noteFor(dateKey) {
    return this.notes.find(item => this.dateKey(new Date(item.date)) === dateKey);
  },

  blocksForDate(date) {
    const day = date.getDay();
    if (day < 1 || day > 5 || this.isHolidayDate(date)) return [];
    const week = this.getWeekType(date);
    return this.blocks.filter(block => Number(block.dayOfWeek) === day && block.weekType === week);
  },

  classForBlock(block) {
    return block?.entryType === 'CLASS' ? this.classes.find(c => c.id === block.classId) || block.class || null : null;
  },

  resolveBlockColor(block) {
    const cls = this.classForBlock(block);
    const title = cls?.name || block?.label || '';
    if (/progress/i.test(title)) return '#4CAF50'; 
    if (/ppa/i.test(title)) return '#632ca6';     
    return cls?.colorHex || (block?.entryType === 'CUSTOM' ? '#64748b' : '#3b82f6');
  },

  getTextColor(hex) {
    let value = String(hex || '#111827').replace('#', '');
    if (value.length === 3) value = value.split('').map(c => c + c).join('');
    const r = parseInt(value.slice(0, 2), 16) || 0;
    const g = parseInt(value.slice(2, 4), 16) || 0;
    const b = parseInt(value.slice(4, 6), 16) || 0;
    return (((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128) ? '#111827' : '#ffffff';
  },

  async resolveDraft(dateKey, period, serverHTML) {
    const local = await window.idb.get(`lesson-draft:${dateKey}:${period}`);
    return local?.planText ?? serverHTML ?? '';
  },

  async resolveNoteDraft(dateKey, serverHTML) {
    const local = await window.idb.get(`note-draft:${dateKey}`);
    return local?.noteText ?? serverHTML ?? '';
  },

  setHeader(text) {
    const el = document.getElementById('pb-date-display');
    if (el) el.innerHTML = `<i class="far fa-calendar"></i> ${window.app.escapeHTML(text)}`;
  },

  async renderDayView() {
    const date = new Date(this.currentDate);
    this.setHeader(date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    const container = document.getElementById('pb-view-container');
    if (!container) return;
    if (date.getDay() === 0 || date.getDay() === 6) {
      container.innerHTML = this.emptyState('Weekend', 'No timetable periods are scheduled.');
      return;
    }
    if (this.isHolidayDate(date)) {
      container.innerHTML = this.emptyState('Calendar closure', 'This date is marked as a holiday/closure in Settings.');
      return;
    }

    const key = this.dateKey(date);
    const blocks = this.blocksForDate(date);
    const teachingPeriods = this.orderedPeriods().filter(p => !p.isBreak);
    const cards = [];
    for (let index = 0; index < teachingPeriods.length; index += 1) {
      const period = teachingPeriods[index];
      const number = this.periodNumber(period, this.orderedPeriods().indexOf(period));
      const block = blocks.find(b => Number(b.period) === number);
      if (!block) continue;
      cards.push(await this.lessonCardHTML(key, period, number, block, false));
    }
    const noteHTML = await this.resolveNoteDraft(key, this.noteFor(key)?.noteText || '');
    container.innerHTML = `
      <div class="flowline-day-shell">
        <section class="flowline-timeline">
          ${cards.length ? cards.join('') : this.emptyState('Timetable empty', 'Add classes or custom blocks in Timetable Builder for this Week A/B day.')}
        </section>
        <aside class="flowline-daily-rail">
          <div class="flowline-rail-head"><span>Daily / HOY notes</span><span class="week-chip">Week ${this.getWeekType(date)}</span></div>
          <div class="flowline-note-editor" contenteditable="true" data-note-date="${key}" data-placeholder="Pastoral notes, calls, reminders…">${noteHTML}</div>
          <div class="flowline-note-help"><i class="fas fa-cloud-arrow-up"></i> Saved locally first, then synced.</div>
        </aside>
      </div>`;
    this.bindEditors();
  },

  async renderWeekView() {
    const monday = this.getMonday(this.currentDate);
    const friday = new Date(monday); friday.setDate(friday.getDate() + 4);
    this.setHeader(`${monday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${friday.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    const container = document.getElementById('pb-view-container');
    if (!container) return;
    const columns = [];
    for (let offset = 0; offset < 5; offset += 1) {
      const date = new Date(monday); date.setDate(monday.getDate() + offset);
      const key = this.dateKey(date);
      const week = this.getWeekType(date);
      const isHoliday = this.isHolidayDate(date);
      const blocks = this.blocksForDate(date);
      const periodRows = [];
      if (!isHoliday) {
        const ordered = this.orderedPeriods();
        for (let index = 0; index < ordered.length; index += 1) {
          const period = ordered[index];
          if (period.isBreak) continue;
          const number = this.periodNumber(period, index);
          const block = blocks.find(b => Number(b.period) === number);
          if (block) periodRows.push(await this.lessonCardHTML(key, period, number, block, true));
        }
      }
      const noteHTML = await this.resolveNoteDraft(key, this.noteFor(key)?.noteText || '');
      columns.push(`
        <section class="flowline-week-column ${isHoliday ? 'is-holiday' : ''}">
          <header class="flowline-day-track"><div><strong>${date.toLocaleDateString('en-GB', { weekday: 'short' })}</strong><span>${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></div><span class="week-chip">${isHoliday ? 'Closed' : `W${week}`}</span></header>
          <div class="flowline-week-note" contenteditable="true" data-note-date="${key}" data-placeholder="Day note…">${noteHTML}</div>
          ${isHoliday ? this.emptyState('Closure', 'Calendar') : (periodRows.length ? periodRows.join('') : this.emptyState('No classes', 'Timetable empty'))}
        </section>`);
    }
    container.innerHTML = `<div class="flowline-week-board">${columns.join('')}</div>`;
    this.bindEditors();
  },

  emptyState(title, text) {
    return `<div class="flowline-empty"><i class="fas fa-calendar-minus"></i><strong>${window.app.escapeHTML(title)}</strong><span>${window.app.escapeHTML(text)}</span></div>`;
  },

  async lessonCardHTML(dateKey, period, periodNumber, block, compact) {
    const cls = this.classForBlock(block);
    const title = cls?.name || block.label || 'Custom block';
    const color = this.resolveBlockColor(block);
    const textColor = this.getTextColor(color); 
    const serverLesson = this.lessonFor(dateKey, periodNumber);
    const planHTML = await this.resolveDraft(dateKey, periodNumber, serverLesson?.planText || '');
    const cardId = `pb-${dateKey}-${periodNumber}`;
    return `
      <article class="flowline-card ${compact ? 'compact' : ''}" style="--class-colour:${color}; --text-colour:${textColor};">
        <div class="flowline-marker"><span>${window.app.escapeHTML(period.label || `P${periodNumber}`)}</span><small>${window.app.escapeHTML(period.startTime || '')}</small></div>
        <div class="flowline-card-main">
          <header class="flowline-card-head"><div><strong>${window.app.escapeHTML(title)}</strong><small>${window.app.escapeHTML(period.startTime || '')}${period.endTime ? ` – ${window.app.escapeHTML(period.endTime)}` : ''}</small></div><button type="button" class="flowline-more" aria-label="Lesson actions" data-menu-target="${cardId}-menu"><i class="fas fa-ellipsis"></i></button></header>
          <div class="flowline-actions" id="${cardId}-menu">
            <button type="button" data-action="skeleton">5-Part</button>
            <button type="button" data-action="format-h1">H1</button>
            <button type="button" data-action="format-h2">H2</button>
            <button type="button" data-action="bold"><i class="fas fa-bold"></i></button>
            <button type="button" data-action="italic"><i class="fas fa-italic"></i></button>
            <button type="button" data-action="underline"><i class="fas fa-underline"></i></button>
            <button type="button" data-action="strike"><i class="fas fa-strikethrough"></i></button>
            <button type="button" data-action="ul"><i class="fas fa-list-ul"></i></button>
            <button type="button" data-action="ol"><i class="fas fa-list-ol"></i></button>
            <button type="button" data-action="checklist" title="Checklist"><i class="far fa-check-square"></i></button>
            <button type="button" data-action="link" title="Insert hyperlink"><i class="fas fa-link"></i> Link</button>
            <button type="button" data-action="table" title="Insert Table"><i class="fas fa-table"></i> Table</button>
            <button type="button" data-action="teams">Teams Link</button>
            <button type="button" data-action="ai">AI Expand</button>
            <button type="button" data-action="bump">Bump</button>
          </div>
          <div id="${cardId}" class="flowline-editor" contenteditable="true" data-date="${dateKey}" data-period="${periodNumber}" data-class-id="${window.app.escapeHTML(block.classId || '')}" data-placeholder="Plan this lesson…">${planHTML}</div>
          <div class="flowline-save-state" data-state-for="${cardId}"><i class="fas fa-check"></i> Ready</div>
        </div>
      </article>`;
  },

  bindEditors() {
    document.querySelectorAll('.flowline-editor').forEach(editor => {
      editor.addEventListener('input', () => this.queueLessonSave(editor));
      editor.addEventListener('blur', () => this.saveLessonNow(editor));
      const card = editor.closest('.flowline-card');
      card?.querySelector('[data-action="skeleton"]')?.addEventListener('click', () => this.insertSkeleton(editor));
      card?.querySelector('[data-action="format-h1"]')?.addEventListener('click', () => document.execCommand('formatBlock', false, '<h1>'));
      card?.querySelector('[data-action="format-h2"]')?.addEventListener('click', () => document.execCommand('formatBlock', false, '<h2>'));
      card?.querySelector('[data-action="bold"]')?.addEventListener('click', () => document.execCommand('bold', false, null));
      card?.querySelector('[data-action="italic"]')?.addEventListener('click', () => document.execCommand('italic', false, null));
      card?.querySelector('[data-action="underline"]')?.addEventListener('click', () => document.execCommand('underline', false, null));
      card?.querySelector('[data-action="strike"]')?.addEventListener('click', () => document.execCommand('strikethrough', false, null));
      card?.querySelector('[data-action="ul"]')?.addEventListener('click', () => document.execCommand('insertUnorderedList', false, null));
      card?.querySelector('[data-action="ol"]')?.addEventListener('click', () => document.execCommand('insertOrderedList', false, null));
      card?.querySelector('[data-action="checklist"]')?.addEventListener('click', () => this.insertChecklist(editor));
      
      const linkButton = card?.querySelector('[data-action="link"]');
      linkButton?.addEventListener('mousedown', event => event.preventDefault());
      linkButton?.addEventListener('click', () => this.insertLink(editor));

      card?.querySelector('[data-action="table"]')?.addEventListener('click', () => this.insertTable(editor));
      card?.querySelector('[data-action="teams"]')?.addEventListener('click', () => this.insertTeamsLink(editor));
      card?.querySelector('[data-action="ai"]')?.addEventListener('click', () => this.aiExpand(editor));
      card?.querySelector('[data-action="bump"]')?.addEventListener('click', () => this.bumpLesson(editor));
    });
    document.querySelectorAll('[data-note-date]').forEach(note => {
      note.addEventListener('input', () => this.queueNoteSave(note));
      note.addEventListener('blur', () => this.saveNoteNow(note));
    });
  },

  lessonSaveKey(editor) { return `lesson:${editor.dataset.date}:${editor.dataset.period}`; },

  stateForEditor(editor, text, mode = 'pending') {
    const id = editor.id;
    const state = document.querySelector(`[data-state-for="${CSS.escape(id)}"]`);
    if (!state) return;
    state.dataset.state = mode;
    state.innerHTML = mode === 'saving' ? `<i class="fas fa-spinner fa-spin"></i> ${text}` : mode === 'offline' ? `<i class="fas fa-cloud-arrow-up"></i> ${text}` : `<i class="fas fa-check"></i> ${text}`;
  },

  async queueLessonSave(editor) {
    const payload = { date: editor.dataset.date, period: Number(editor.dataset.period), classId: editor.dataset.classId || null, planText: editor.innerHTML };
    const key = this.lessonSaveKey(editor);
    await window.idb.set(`lesson-draft:${payload.date}:${payload.period}`, payload);
    this.pendingSaves.set(key, { type: 'lesson', payload, editor });
    this.stateForEditor(editor, 'Saved locally', 'offline');
    clearTimeout(this.saveTimers.get(key));
    this.saveTimers.set(key, setTimeout(() => this.saveLessonNow(editor), 650));
  },

  async saveLessonNow(editor) {
    const key = this.lessonSaveKey(editor);
    const pending = this.pendingSaves.get(key) || { payload: { date: editor.dataset.date, period: Number(editor.dataset.period), classId: editor.dataset.classId || null, planText: editor.innerHTML }, editor };
    clearTimeout(this.saveTimers.get(key)); this.saveTimers.delete(key);
    this.stateForEditor(editor, 'Saving…', 'saving');
    try {
      const response = await window.flowSync.request('/api/lessons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.payload) }, true);
      if (response) {
        await window.idb.delete(`lesson-draft:${pending.payload.date}:${pending.payload.period}`);
        this.stateForEditor(editor, 'Saved', 'saved');
      } else this.stateForEditor(editor, 'Queued offline', 'offline');
      this.pendingSaves.delete(key);
    } catch (error) {
      console.error(error);
      this.stateForEditor(editor, 'Local copy retained', 'offline');
    }
  },

  async queueNoteSave(note) {
    const payload = { date: note.dataset.noteDate, noteText: note.innerHTML };
    const key = `note:${payload.date}`;
    await window.idb.set(`note-draft:${payload.date}`, payload);
    this.pendingSaves.set(key, { type: 'note', payload, editor: note });
    clearTimeout(this.saveTimers.get(key));
    this.saveTimers.set(key, setTimeout(() => this.saveNoteNow(note), 650));
  },

  async saveNoteNow(note) {
    const key = `note:${note.dataset.noteDate}`;
    const pending = this.pendingSaves.get(key) || { payload: { date: note.dataset.noteDate, noteText: note.innerHTML }, editor: note };
    clearTimeout(this.saveTimers.get(key)); this.saveTimers.delete(key);
    try {
      const response = await window.flowSync.request('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.payload) }, true);
      if (response) await window.idb.delete(`note-draft:${pending.payload.date}`);
      this.pendingSaves.delete(key);
    } catch (error) { console.error(error); }
  },

  async flushPendingSaves() {
    const pending = [...this.pendingSaves.values()];
    for (const item of pending) {
      if (item.type === 'lesson' && item.editor?.isConnected) await this.saveLessonNow(item.editor);
      if (item.type === 'note' && item.editor?.isConnected) await this.saveNoteNow(item.editor);
    }
  },

  insertHTML(editor, html) {
    editor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0); range.deleteContents();
      const frag = range.createContextualFragment(html); range.insertNode(frag); range.collapse(false);
    } else editor.insertAdjacentHTML('beforeend', html);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  },

  insertSkeleton(editor) {
    this.insertHTML(editor, `<section><p><strong>1. Do Now / Retrieval</strong></p><p><br></p><p><strong>2. Explain / Model</strong></p><p><br></p><p><strong>3. Guided Practice</strong></p><p><br></p><p><strong>4. Independent Practice</strong></p><p><br></p><p><strong>5. Check / Exit</strong></p><p><br></p></section>`);
  },

  insertTable(editor) {
    this.insertHTML(editor, `<table style="width:100%; border-collapse: collapse; border: 1px solid var(--border); margin: 8px 0;"><tbody><tr><td style="border: 1px solid var(--border); padding: 6px;">Header 1</td><td style="border: 1px solid var(--border); padding: 6px;">Header 2</td></tr><tr><td style="border: 1px solid var(--border); padding: 6px;">Cell</td><td style="border: 1px solid var(--border); padding: 6px;">Cell</td></tr></tbody></table><p><br></p>`);
  },
  
  insertChecklist(editor) {
      // Injects a physical checkbox element into the text
      this.insertHTML(editor, `<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;"><input type="checkbox" style="width:16px; height:16px; cursor:pointer;"> <span>Task...</span></div><br>`);
  },

  insertLink(editor) {
    const selection = window.getSelection();
    let savedRange = null;
    if (selection?.rangeCount) {
      const candidate = selection.getRangeAt(0);
      if (editor.contains(candidate.commonAncestorContainer)) savedRange = candidate.cloneRange();
    }

    const raw = prompt('Paste the URL you want to link to:');
    if (!raw) return;
    let url = window.app.stripMarkdownUrl(raw).trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
    try { new URL(url); } catch (_) { return window.app.showToast('Please enter a valid URL.', 'error'); }

    editor.focus();
    const liveSelection = window.getSelection();
    if (savedRange) {
      liveSelection.removeAllRanges();
      liveSelection.addRange(savedRange);
    }

    let range = liveSelection?.rangeCount ? liveSelection.getRangeAt(0) : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      liveSelection.removeAllRanges();
      liveSelection.addRange(range);
    }
    if (range.collapsed) {
      const textNode = document.createTextNode(url);
      range.insertNode(textNode);
      const textRange = document.createRange();
      textRange.selectNodeContents(textNode);
      liveSelection.removeAllRanges();
      liveSelection.addRange(textRange);
    }

    document.execCommand('createLink', false, url);
    editor.querySelectorAll('a').forEach(anchor => {
      if (anchor.href === url || anchor.getAttribute('href') === url) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
      }
    });
    liveSelection.collapseToEnd();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  },

  insertTeamsLink(editor) {
    const raw = prompt('Paste the Microsoft Teams lesson/resource link:');
    if (!raw) return;
    const url = window.app.stripMarkdownUrl(raw);
    if (!/^https:\/\//i.test(url)) return window.app.showToast('Please paste a valid https:// link.', 'error');
    const safe = window.app.escapeHTML(url);
    this.insertHTML(editor, `<p><a href="${safe}" target="_blank" rel="noopener noreferrer">Open in Microsoft Teams</a></p>`);
  },

  async aiExpand(editor) {
    const source = editor.innerText.trim();
    if (!source) return window.app.showToast('Add a few lesson notes first.', 'error');
    this.stateForEditor(editor, 'AI expanding…', 'saving');
    try {
      const res = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: `Expand these teacher notes into a concise, practical UK secondary lesson plan. Keep any stated facts unchanged and use clear headings. Notes:\n${source}` }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'AI request failed');
      editor.innerHTML = data.text || editor.innerHTML;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) {
      window.app.showToast(error.message, 'error');
      this.stateForEditor(editor, 'Local copy retained', 'offline');
    }
  },

  async bumpLesson(editor) {
    const classId = editor.dataset.classId;
    if (!classId) return window.app.showToast('Bump is only available for a scheduled class.', 'error');
    const from = window.app.parseLocalDate(editor.dataset.date);
    const next = this.findNextTeachingOccurrence(classId, from);
    if (!next) return window.app.showToast('No later occurrence found in the next 120 days.', 'error');
    const payload = { date: next.dateKey, period: next.period, classId, planText: editor.innerHTML };
    await window.idb.set(`lesson-draft:${payload.date}:${payload.period}`, payload);
    try {
      const res = await window.flowSync.request('/api/lessons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, true);
      if (res) await window.idb.delete(`lesson-draft:${payload.date}:${payload.period}`);
      window.app.showToast(`Bumped to ${next.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}.`);
    } catch (error) { window.app.showToast(error.message, 'error'); }
  },

  findNextTeachingOccurrence(classId, fromDate) {
    for (let offset = 1; offset <= 120; offset += 1) {
      const date = new Date(fromDate); date.setDate(fromDate.getDate() + offset);
      if (date.getDay() < 1 || date.getDay() > 5 || this.isHolidayDate(date)) continue;
      const week = this.getWeekType(date);
      const blocks = this.blocks.filter(block => block.entryType === 'CLASS' && block.classId === classId && block.weekType === week && Number(block.dayOfWeek) === date.getDay());
      if (blocks.length) {
        blocks.sort((a, b) => Number(a.period) - Number(b.period));
        return { date, dateKey: this.dateKey(date), period: Number(blocks[0].period) };
      }
    }
    return null;
  },

  print() { window.print(); }
};
