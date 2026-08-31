window.timetableController = {
  dayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  autoPinTimer: null,
  pinBusy: false,
  lastAutoPinned: '',
  rosterCache: null,
  rosterClassIndex: null,

  async init() {
    await this.loadInitialData();
    await this.ensureRosterIndex(true);
    await this.renderClassSettingsUI();
    this.renderCustomElements();
    this.renderDnDGrid();
    this.bindClassSearch();
  },

  async destroy() {
    clearTimeout(this.autoPinTimer);
    this.autoPinTimer = null;
  },

  async loadInitialData() {
    const [resP, resC, resT] = await Promise.all([
      fetch('/api/periods'),
      fetch('/api/classes'),
      fetch('/api/timetable')
    ]);
    if (!resP.ok || !resC.ok || !resT.ok) throw new Error('Could not hydrate timetable data.');
    window.appState.rawPeriods = await resP.json();
    window.appState.classes = await resC.json();
    window.appState.blocks = await resT.json();
  },

  getTeachingPeriods() {
    return (window.appState.rawPeriods || [])
      .slice()
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  },

  getPeriodNumber(period, index) {
    // TimetableSlot.period is deliberately the stable numeric DayPeriod.sortOrder.
    return Number(period.sortOrder || (index + 1));
  },

  getTextColor(hex) {
    let value = String(hex || '#111827').replace('#', '');
    if (value.length === 3) value = value.split('').map(c => c + c).join('');
    const r = parseInt(value.slice(0, 2), 16) || 0;
    const g = parseInt(value.slice(2, 4), 16) || 0;
    const b = parseInt(value.slice(4, 6), 16) || 0;
    return (((r * 299) + (g * 587) + (b * 114)) / 1000 >= 128) ? '#111827' : '#ffffff';
  },

  getSelectedWeek() {
    return document.getElementById('builder-week-select')?.value || 'A';
  },

  bindClassSearch() {
    const input = document.getElementById('timetable-class-search');
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(this.autoPinTimer);
      const typed = input.value.trim();
      this.autoPinTimer = setTimeout(async () => {
        const index = await this.ensureRosterIndex();
        const match = index.get(typed.toLowerCase());
        const exact = match?.name;
        if (exact && exact.toLowerCase() !== this.lastAutoPinned) {
          await this.pinClassToSidebar(exact, { silentNotFound: true });
          this.lastAutoPinned = exact.toLowerCase();
        }
      }, 220);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.pinClassToSidebar();
      }
    });
  },

  async ensureRosterIndex(force = false) {
    if (!force && this.rosterCache && this.rosterClassIndex) return this.rosterClassIndex;
    const roster = await window.idb.get('wholeSchoolRoster') || [];
    const index = new Map();
    roster.forEach(student => {
      const rawClasses = Array.isArray(student.classes) ? student.classes : String(student.classes || '').split(/[,;|]/);
      rawClasses.map(v => String(v).trim()).filter(Boolean).forEach(className => {
        const key = className.toLowerCase();
        if (!index.has(key)) index.set(key, { name: className, students: [] });
        index.get(key).students.push(student);
      });
    });
    this.rosterCache = roster;
    this.rosterClassIndex = index;
    return index;
  },

  uniqueRosterClasses(roster = null) {
    if (this.rosterClassIndex && !roster) return [...this.rosterClassIndex.values()].map(item => item.name).sort((a,b) => a.localeCompare(b, 'en-GB', { numeric:true }));
    const names = new Set();
    (roster || this.rosterCache || []).forEach(student => {
      const classes = Array.isArray(student.classes) ? student.classes : String(student.classes || '').split(/[,;|]/);
      classes.map(v => String(v).trim()).filter(Boolean).forEach(v => names.add(v));
    });
    return [...names].sort((a, b) => a.localeCompare(b, 'en-GB', { numeric: true }));
  },

  studentBelongsToClass(student, className) {
    const target = String(className || '').trim().toLowerCase();
    return String(student.classes || '')
      .split(/[,;|]/)
      .map(v => v.trim().toLowerCase())
      .filter(Boolean)
      .includes(target);
  },

  previewClassColor(classId, hexColor) {
    const pill = document.getElementById(`c-${classId}`);
    if (pill) {
      pill.style.backgroundColor = hexColor;
      pill.style.borderColor = hexColor;
      pill.style.color = this.getTextColor(hexColor);
    }
    document.querySelectorAll(`.draggable-item[data-classid="${CSS.escape(classId)}"]`).forEach(block => {
      block.style.backgroundColor = hexColor;
      block.style.borderColor = hexColor;
      block.style.color = this.getTextColor(hexColor);
    });
  },

  async saveClassColor(classId, hexColor) {
    const res = await fetch(`/api/classes/${encodeURIComponent(classId)}/color`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colorHex: hexColor })
    });
    if (!res.ok) return window.app.showToast('Could not save class colour.', 'error');
    const cls = (window.appState.classes || []).find(c => c.id === classId);
    if (cls) cls.colorHex = hexColor;
  },

  dragEntity(ev, id, type, sourceDay = null, sourcePeriod = null) {
    ev.dataTransfer.effectAllowed = 'copyMove';
    ev.dataTransfer.setData('text/plain', JSON.stringify({
      id, type, sourceDay, sourcePeriod,
      isClone: ev.ctrlKey || ev.altKey || ev.metaKey
    }));
  },

  allowDrop(ev) {
    ev.preventDefault();
    ev.currentTarget?.classList.add('drag-over');
  },

  dragLeave(ev) {
    ev.currentTarget?.classList.remove('drag-over');
  },

  dropToTimetable(ev) {
    ev.preventDefault();
    const target = ev.currentTarget?.classList?.contains('drop-zone') ? ev.currentTarget : ev.target.closest('.drop-zone');
    if (!target) return;
    target.classList.remove('drag-over');

    let payload;
    try { payload = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch { return; }

    const day = Number(target.dataset.day);
    const period = Number(target.dataset.period);
    const weekType = this.getSelectedWeek();

    if (payload.sourceDay != null && payload.sourcePeriod != null && !payload.isClone) {
      this.removeBlock(Number(payload.sourceDay), Number(payload.sourcePeriod), weekType);
    }
    window.appState.blocks = (window.appState.blocks || []).filter(block => !(
      Number(block.dayOfWeek) === day && Number(block.period) === period && block.weekType === weekType
    ));

    if (payload.type === 'CLASS') {
      const classId = String(payload.id).replace(/^c-/, '');
      const cls = (window.appState.classes || []).find(c => c.id === classId);
      if (cls) window.appState.blocks.push({ entryType: 'CLASS', classId, class: cls, dayOfWeek: day, period, weekType });
    } else if (payload.type === 'CUSTOM') {
      const custom = this.getCustomElements().find(item => item.id === payload.id);
      const label = custom?.label || payload.label || payload.id;
      window.appState.blocks.push({ entryType: 'CUSTOM', label, dayOfWeek: day, period, weekType });
    }
    this.renderDnDGrid();
  },

  removeBlock(day, period, weekType) {
    window.appState.blocks = (window.appState.blocks || []).filter(block => !(
      Number(block.dayOfWeek) === Number(day) && Number(block.period) === Number(period) && block.weekType === weekType
    ));
    this.renderDnDGrid();
  },

  renderDnDGrid() {
    const grid = document.getElementById('dnd-master-grid');
    if (!grid) return;
    const selectedWeek = this.getSelectedWeek();
    const esc = window.app.escapeHTML;
    let html = '<div class="tt-corner">Period</div>';
    this.dayNames.forEach(day => { html += `<div class="tt-day-head">${day}</div>`; });

    this.getTeachingPeriods().forEach((period, index) => {
      const periodNumber = this.getPeriodNumber(period, index);
      html += `<div class="tt-period-label"><strong>${esc(period.label || `P${periodNumber}`)}</strong><small>${esc(period.startTime || '')}${period.endTime ? ` – ${esc(period.endTime)}` : ''}</small></div>`;
      if (period.isBreak) {
        html += `<div class="tt-break" style="grid-column:span 5">${esc(period.label || 'Break')}</div>`;
        return;
      }

      for (let day = 1; day <= 5; day += 1) {
        const block = (window.appState.blocks || []).find(b => Number(b.dayOfWeek) === day && Number(b.period) === periodNumber && b.weekType === selectedWeek);
        let content = '';
        if (block) {
          const isClass = block.entryType === 'CLASS';
          const cls = isClass ? ((window.appState.classes || []).find(c => c.id === block.classId) || block.class) : null;
          const label = isClass ? (cls?.name || 'Class') : (block.label || 'Custom');
          const color = isClass ? (cls?.colorHex || '#3b82f6') : '#64748b';
          const text = this.getTextColor(color);
          const dragId = isClass ? `c-${block.classId}` : this.findCustomIdByLabel(label);
          content = `<div class="draggable-item tt-grid-pill ${isClass ? 'tt-class-pill' : 'tt-custom-pill'}" draggable="true" data-classid="${esc(block.classId || '')}" data-drag-id="${esc(dragId)}" data-entry-type="${esc(block.entryType)}" style="background:${color};border-color:${color};color:${text}"><span>${esc(label)}</span><button type="button" class="tt-remove" aria-label="Remove ${esc(label)}" title="Remove">×</button></div>`;
        }
        html += `<div class="drop-zone" data-day="${day}" data-period="${periodNumber}">${content}</div>`;
      }
    });
    grid.innerHTML = html;

    grid.querySelectorAll('.drop-zone').forEach(zone => {
      zone.addEventListener('dragover', event => this.allowDrop(event));
      zone.addEventListener('dragleave', event => this.dragLeave(event));
      zone.addEventListener('drop', event => this.dropToTimetable(event));
    });
    grid.querySelectorAll('.tt-grid-pill').forEach(pill => {
      const zone = pill.closest('.drop-zone');
      pill.addEventListener('dragstart', event => this.dragEntity(
        event,
        pill.dataset.dragId,
        pill.dataset.entryType,
        Number(zone.dataset.day),
        Number(zone.dataset.period)
      ));
      pill.querySelector('.tt-remove')?.addEventListener('click', event => {
        event.stopPropagation();
        this.removeBlock(Number(zone.dataset.day), Number(zone.dataset.period), selectedWeek);
      });
    });
  },

  async saveTimetable(btn) {
    const selectedWeek = this.getSelectedWeek();
    const slots = (window.appState.blocks || []).filter(b => b.weekType === selectedWeek).map(b => ({
      dayOfWeek: Number(b.dayOfWeek),
      period: Number(b.period),
      weekType: selectedWeek,
      entryType: b.entryType,
      classId: b.entryType === 'CLASS' ? b.classId : null,
      label: b.entryType === 'CUSTOM' ? b.label : null
    }));
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    try {
      const res = await fetch('/api/timetable', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekType: selectedWeek, slots })
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message || 'Save failed');
      // Server is authoritative. Do not render until BOTH weeks have been re-hydrated.
      await this.loadInitialData();
      await this.renderClassSettingsUI();
      this.renderDnDGrid();
      window.app.showToast(`Week ${selectedWeek} timetable saved.`);
    } catch (error) {
      console.error(error);
      window.app.showToast(error.message || 'Could not save timetable.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  },

  async renderClassSettingsUI() {
    await this.ensureRosterIndex();
    const roster = this.rosterCache || [];
    const datalist = document.getElementById('all-classes-list');
    if (datalist) datalist.innerHTML = this.uniqueRosterClasses().map(name => `<option value="${window.app.escapeHTML(name)}"></option>`).join('');

    let pinned = JSON.parse(localStorage.getItem('pinnedClasses') || '[]');
    (window.appState.classes || []).filter(c => c.isPinned).forEach(c => { if (!pinned.includes(c.id)) pinned.push(c.id); });
    (window.appState.blocks || []).filter(b => b.entryType === 'CLASS').forEach(b => { if (b.classId && !pinned.includes(b.classId)) pinned.push(b.classId); });
    localStorage.setItem('pinnedClasses', JSON.stringify(pinned));

    const container = document.getElementById('class-list-container');
    if (!container) return;
    container.innerHTML = '';
    (window.appState.classes || []).filter(c => pinned.includes(c.id)).forEach(cls => {
      const row = document.createElement('div');
      row.className = 'tt-class-row';
      const hex = cls.colorHex || '#3b82f6';
      row.innerHTML = `
        <input type="color" value="${hex}" title="Change class colour" aria-label="Change class colour for ${window.app.escapeHTML(cls.name)}" class="tt-colour-picker">
        <div class="draggable-item tt-sidebar-pill" draggable="true" id="c-${cls.id}" style="background:${hex};border-color:${hex};color:${this.getTextColor(hex)}">${window.app.escapeHTML(cls.name)} <small>${cls.students?.length || 0}</small></div>`;
      const colour = row.querySelector('.tt-colour-picker');
      colour.addEventListener('input', () => this.previewClassColor(cls.id, colour.value));
      colour.addEventListener('change', () => this.saveClassColor(cls.id, colour.value));
      row.querySelector('.tt-sidebar-pill').addEventListener('dragstart', event => this.dragEntity(event, `c-${cls.id}`, 'CLASS'));
      container.appendChild(row);
    });
  },

  getCustomElements() {
    try { return JSON.parse(localStorage.getItem('flowdeskTimetableCustomElements') || '[]'); }
    catch { return []; }
  },

  setCustomElements(items) {
    localStorage.setItem('flowdeskTimetableCustomElements', JSON.stringify(items));
  },

  findCustomIdByLabel(label) {
    return this.getCustomElements().find(item => item.label === label)?.id || `custom:${label}`;
  },

  createTimetableElement() {
    const input = document.getElementById('new-elem-name');
    const label = input?.value.trim();
    if (!label) return;
    const items = this.getCustomElements();
    const existing = items.find(item => item.label.toLowerCase() === label.toLowerCase());
    if (!existing) items.push({ id: `custom-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`, label });
    this.setCustomElements(items);
    input.value = '';
    this.renderCustomElements();
  },

  removeCustomElement(id) {
    this.setCustomElements(this.getCustomElements().filter(item => item.id !== id));
    this.renderCustomElements();
  },

  renderCustomElements() {
    const container = document.getElementById('custom-elements-list');
    if (!container) return;
    container.innerHTML = '';
    this.getCustomElements().forEach(item => {
      const row = document.createElement('div');
      row.className = 'tt-custom-row';
      row.innerHTML = `<div class="draggable-item tt-sidebar-pill tt-custom-pill" draggable="true">${window.app.escapeHTML(item.label)}</div><button type="button" class="icon-button" title="Delete custom block" aria-label="Delete ${window.app.escapeHTML(item.label)}">×</button>`;
      row.querySelector('.draggable-item').addEventListener('dragstart', event => this.dragEntity(event, item.id, 'CUSTOM'));
      row.querySelector('button').addEventListener('click', () => this.removeCustomElement(item.id));
      container.appendChild(row);
    });
  },

  async pinClassToSidebar(explicitName = '', options = {}) {
    if (this.pinBusy) return;
    const input = document.getElementById('timetable-class-search');
    const className = String(explicitName || input?.value || '').trim();
    if (!className) return;
    const index = await this.ensureRosterIndex();
    if (!this.rosterCache?.length) return options.silentNotFound ? undefined : window.app.showToast('Upload the Master File in Settings first.', 'error');
    let indexedClass = index.get(className.toLowerCase());
    if (!indexedClass) {
      // One forced refresh covers the case where Settings imported a new roster while this view stayed mounted.
      indexedClass = (await this.ensureRosterIndex(true)).get(className.toLowerCase());
    }
    const classStudents = indexedClass?.students || [];
    if (!classStudents.length) return options.silentNotFound ? undefined : window.app.showToast('Class not found in the current Arbor roster.', 'error');

    this.pinBusy = true;
    if (input) { input.disabled = true; input.value = 'Importing…'; }
    try {
      const payload = classStudents.map(student => ({
        externalRef: student.externalRef || student.id || student.upn || null,
        name: student.name,
        yearGroup: student.yearGroup || student.year || null,
        sen: !!student.sen,
        pp: !!student.pp,
        fsm: !!student.fsm,
        catMean: student.catMean || student.cat || null,
        targetGrade: student.targetGrade || null,
        gender: student.gender || student.sex || null
      }));
      const res = await fetch('/api/students/bulk-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ students: payload, className })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'Class import failed');

      const pinned = JSON.parse(localStorage.getItem('pinnedClasses') || '[]');
      if (data.classId && !pinned.includes(data.classId)) {
        pinned.push(data.classId);
        localStorage.setItem('pinnedClasses', JSON.stringify(pinned));
      }
      const classesRes = await fetch('/api/classes');
      if (classesRes.ok) window.appState.classes = await classesRes.json();
      await this.renderClassSettingsUI();
      if (!options.silentNotFound) window.app.showToast(`${className} pinned.`);
    } catch (error) {
      console.error(error);
      window.app.showToast(error.message || 'Could not pin class.', 'error');
    } finally {
      this.pinBusy = false;
      if (input) { input.disabled = false; input.value = ''; input.focus(); }
    }
  }
};
