window.timetableController = {
  dayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  autoPinTimer: null,
  pinBusy: false,
  lastAutoPinned: '',
  rosterCache: null,
  rosterClassIndex: null,

  async init() {
    // router.loadView() has already hydrated window.appState atomically.
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

  getTeachingPeriods() {
    return (window.appState.rawPeriods || [])
      .slice()
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  },

  getPeriodNumber(period, index) {
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

  hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return `#${[r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
  },

  colorDistance(a, b) {
    const rgb = hex => {
      const value = String(hex || '').replace('#', '').padEnd(6, '0');
      return [parseInt(value.slice(0, 2), 16) || 0, parseInt(value.slice(2, 4), 16) || 0, parseInt(value.slice(4, 6), 16) || 0];
    };
    const aa = rgb(a), bb = rgb(b);
    return Math.sqrt(((aa[0] - bb[0]) ** 2) + ((aa[1] - bb[1]) ** 2) + ((aa[2] - bb[2]) ** 2));
  },

  randomCustomColor(existingColors = []) {
    let candidate = '#7c3aed';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      candidate = this.hslToHex(Math.floor(Math.random() * 360), 72 + Math.floor(Math.random() * 17), 44 + Math.floor(Math.random() * 13));
      if (existingColors.every(color => this.colorDistance(candidate, color) >= 85)) return candidate;
    }
    return candidate;
  },

  getSelectedWeek() {
    return document.getElementById('builder-week-select')?.value || 'A';
  },

  bindClassSearch() {
    const input = document.getElementById('timetable-class-search');
    if (!input || input.dataset.pinBound === 'true') return;
    input.dataset.pinBound = 'true';

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
      const rawClasses = Array.isArray(student.classes)
        ? student.classes
        : String(student.classes || '').split(/[,;|]/);

      rawClasses.map(value => String(value).trim()).filter(Boolean).forEach(className => {
        const key = className.toLowerCase();
        if (!index.has(key)) index.set(key, { name: className, students: [] });
        index.get(key).students.push(student);
      });
    });

    this.rosterCache = roster;
    this.rosterClassIndex = index;
    return index;
  },

  uniqueRosterClasses() {
    if (!this.rosterClassIndex) return [];
    return [...this.rosterClassIndex.values()]
      .map(item => item.name)
      .sort((a, b) => a.localeCompare(b, 'en-GB', { numeric: true }));
  },

  previewClassColor(classId, hexColor) {
    const pill = document.getElementById(`c-${classId}`);
    if (pill) {
      pill.style.backgroundColor = hexColor;
      pill.style.borderColor = hexColor;
      pill.style.color = this.getTextColor(hexColor);
    }
    document.querySelectorAll('.draggable-item[data-classid]').forEach(block => {
      if (block.dataset.classid !== classId) return;
      block.style.backgroundColor = hexColor;
      block.style.borderColor = hexColor;
      block.style.color = this.getTextColor(hexColor);
    });
  },

  async saveClassColor(classId, hexColor) {
    const res = await fetch(`/api/classes/${encodeURIComponent(classId)}/color`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colorHex: hexColor })
    });
    if (!res.ok) return window.app.showToast('Could not save class colour.', 'error');
    const cls = (window.appState.classes || []).find(c => c.id === classId);
    if (cls) cls.colorHex = hexColor;
  },

  dragEntity(ev, id, type, sourceDay = null, sourcePeriod = null, label = null) {
    const safeType = type === 'CLASS' ? 'CLASS' : type === 'CUSTOM' ? 'CUSTOM' : null;
    if (!safeType || id == null) {
      ev.preventDefault();
      return;
    }

    ev.dataTransfer.effectAllowed = 'copyMove';
    ev.dataTransfer.setData('text/plain', JSON.stringify({
      id: String(id),
      type: safeType,
      label: label == null ? null : String(label),
      sourceDay,
      sourcePeriod,
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
    try { payload = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch (_) { return; }
    if (!payload || !['CLASS', 'CUSTOM'].includes(payload.type) || payload.id == null) return;

    const day = Number(target.dataset.day);
    const period = Number(target.dataset.period);
    const weekType = this.getSelectedWeek();
    if (!Number.isFinite(day) || !Number.isFinite(period)) return;

    if (payload.sourceDay != null && payload.sourcePeriod != null && !payload.isClone) {
      this.removeBlock(Number(payload.sourceDay), Number(payload.sourcePeriod), weekType, false);
    }

    window.appState.blocks = (window.appState.blocks || []).filter(block => !(
      Number(block.dayOfWeek) === day && Number(block.period) === period && block.weekType === weekType
    ));

    if (payload.type === 'CLASS') {
      const classId = String(payload.id).replace(/^c-/, '');
      const cls = (window.appState.classes || []).find(c => c.id === classId);
      if (!cls) return;
      window.appState.blocks.push({
        entryType: 'CLASS', classId, class: cls, dayOfWeek: day, period, weekType
      });
    } else {
      const custom = this.getCustomElements().find(item => item.id === String(payload.id));
      const label = String(payload.label || custom?.label || '').trim();
      if (!label) return window.app.showToast('That custom block has no label and was not added.', 'error');
      window.appState.blocks.push({
        entryType: 'CUSTOM', classId: null, label, dayOfWeek: day, period, weekType
      });
    }

    this.renderDnDGrid();
  },

  removeBlock(day, period, weekType, rerender = true) {
    window.appState.blocks = (window.appState.blocks || []).filter(block => !(
      Number(block.dayOfWeek) === Number(day) && Number(block.period) === Number(period) && block.weekType === weekType
    ));
    if (rerender) this.renderDnDGrid();
  },

  renderDnDGrid() {
    const grid = document.getElementById('dnd-master-grid');
    if (!grid) return;
    const selectedWeek = this.getSelectedWeek();
    const esc = window.app.escapeHTML;
    let html = '<div class="tt-corner">Period</div>';
    this.dayNames.forEach(day => { html += `<div class="tt-day-head">${day}</div>`; });

    const periods = this.getTeachingPeriods();
    if (!periods.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:30px;text-align:center;color:var(--text-muted);">Configure your school day in Settings before building the timetable.</div>';
      return;
    }

    periods.forEach((period, index) => {
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
          const custom = isClass ? null : this.findCustomByLabel(label);
          const color = isClass ? (cls?.colorHex || '#3b82f6') : (custom?.color || '#7c3aed');
          const text = this.getTextColor(color);
          const dragId = isClass ? `c-${block.classId}` : this.findCustomIdByLabel(label);
          content = `<div class="draggable-item tt-grid-pill ${isClass ? 'tt-class-pill' : 'tt-custom-pill'}" draggable="true" data-classid="${esc(block.classId || '')}" data-drag-id="${esc(dragId)}" data-entry-type="${esc(block.entryType)}" data-label="${esc(label)}" style="background:${color};border-color:${color};color:${text}"><span>${esc(label)}</span><button type="button" class="tt-remove" aria-label="Remove ${esc(label)}" title="Remove">×</button></div>`;
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
        Number(zone.dataset.period),
        pill.dataset.label
      ));
      pill.querySelector('.tt-remove')?.addEventListener('click', event => {
        event.stopPropagation();
        this.removeBlock(Number(zone.dataset.day), Number(zone.dataset.period), selectedWeek);
      });
    });
  },

  async saveTimetable(btn) {
    if (!window.appState.globalHydrated) return window.app.showToast('Timetable data is still loading. Please try again.', 'error');

    const selectedWeek = this.getSelectedWeek();
    const blocks = (window.appState.blocks || [])
      .filter(block => block.weekType === selectedWeek)
      .map(block => ({
        dayOfWeek: Number(block.dayOfWeek),
        period: Number(block.period),
        weekType: selectedWeek,
        entryType: block.entryType,
        classId: block.entryType === 'CLASS' ? block.classId : null,
        label: block.entryType === 'CUSTOM' ? String(block.label || '').trim() : null
      }))
      .filter(block => block.entryType === 'CLASS' ? !!block.classId : !!block.label);

    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

    try {
      const res = await fetch('/api/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks, weekType: selectedWeek })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || 'Save failed');

      await window.app.loadGlobalData();
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
    const datalist = document.getElementById('all-classes-list');
    if (datalist) {
      datalist.innerHTML = this.uniqueRosterClasses()
        .map(name => `<option value="${window.app.escapeHTML(name)}"></option>`)
        .join('');
    }

    let pinned = JSON.parse(localStorage.getItem('pinnedClasses') || '[]');
    (window.appState.classes || []).filter(c => c.isPinned).forEach(c => {
      if (!pinned.includes(c.id)) pinned.push(c.id);
    });
    (window.appState.blocks || []).filter(b => b.entryType === 'CLASS').forEach(b => {
      if (b.classId && !pinned.includes(b.classId)) pinned.push(b.classId);
    });
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
        <div class="draggable-item tt-sidebar-pill" draggable="true" id="c-${cls.id}" data-classid="${cls.id}" style="background:${hex};border-color:${hex};color:${this.getTextColor(hex)}">${window.app.escapeHTML(cls.name)} <small>${cls.students?.length || 0}</small></div>`;

      const colour = row.querySelector('.tt-colour-picker');
      colour.addEventListener('input', () => this.previewClassColor(cls.id, colour.value));
      colour.addEventListener('change', () => this.saveClassColor(cls.id, colour.value));
      row.querySelector('.tt-sidebar-pill').addEventListener('dragstart', event => this.dragEntity(event, `c-${cls.id}`, 'CLASS'));
      container.appendChild(row);
    });
  },

  getCustomElements() {
    try {
      const raw = JSON.parse(localStorage.getItem('flowdeskTimetableCustomElements') || '[]');
      const items = Array.isArray(raw) ? raw.filter(item => item && item.id && item.label) : [];
      let changed = false;
      const colors = items.map(item => item.color).filter(Boolean);
      items.forEach(item => {
        if (!/^#[0-9a-f]{6}$/i.test(String(item.color || ''))) {
          item.color = this.randomCustomColor(colors);
          colors.push(item.color);
          changed = true;
        }
      });
      if (changed) this.setCustomElements(items);
      return items;
    } catch (_) {
      return [];
    }
  },

  setCustomElements(items) {
    localStorage.setItem('flowdeskTimetableCustomElements', JSON.stringify(items));
  },

  findCustomByLabel(label) {
    return this.getCustomElements().find(item => item.label === label) || null;
  },

  findCustomIdByLabel(label) {
    return this.findCustomByLabel(label)?.id || `custom:${label}`;
  },

  async createTimetableElement(button) {
    const input = document.getElementById('new-elem-name');
    const label = input?.value.trim();
    if (!label) return;
    const original = button?.innerHTML;
    if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
      const items = this.getCustomElements();
      const existing = items.find(item => item.label.toLowerCase() === label.toLowerCase());
      if (!existing) {
        const uuid = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const color = this.randomCustomColor(items.map(item => item.color).filter(Boolean));
        items.push({ id: `custom-${uuid}`, label, color });
        this.setCustomElements(items);
      }
      input.value = '';
      this.renderCustomElements();
    } finally {
      if (button) { button.disabled = false; button.innerHTML = original; }
    }
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
      row.innerHTML = `<div class="draggable-item tt-sidebar-pill tt-custom-pill" draggable="true" style="background:${item.color};border-color:${item.color};color:${this.getTextColor(item.color)}">${window.app.escapeHTML(item.label)}</div><button type="button" class="icon-button" title="Delete custom block" aria-label="Delete ${window.app.escapeHTML(item.label)}">×</button>`;
      row.querySelector('.draggable-item').addEventListener('dragstart', event => this.dragEntity(event, item.id, 'CUSTOM', null, null, item.label));
      row.querySelector('button').addEventListener('click', () => this.removeCustomElement(item.id));
      container.appendChild(row);
    });
  },

  async getOrCreatePinnedClass(className) {
    const existing = (window.appState.classes || []).find(cls => String(cls.name || '').trim().toLowerCase() === className.toLowerCase());
    if (existing?.id) return existing.id;

    const response = await fetch('/api/classes/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: className })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.classId) throw new Error(data?.error?.message || 'Could not create class');
    return data.classId;
  },

  async pinClassToSidebar(explicitName = '', options = {}) {
    if (this.pinBusy) return;
    const input = document.getElementById('timetable-class-search');
    const className = String(explicitName || input?.value || '').trim();
    if (!className) return;

    const index = await this.ensureRosterIndex();
    if (!this.rosterCache?.length) {
      if (!options.silentNotFound) window.app.showToast('Upload the Master File in Settings first.', 'error');
      return;
    }

    let indexedClass = index.get(className.toLowerCase());
    if (!indexedClass) indexedClass = (await this.ensureRosterIndex(true)).get(className.toLowerCase());
    const classStudents = indexedClass?.students || [];
    if (!classStudents.length) {
      if (!options.silentNotFound) window.app.showToast('Class not found in the current Arbor roster.', 'error');
      return;
    }

    this.pinBusy = true;
    if (input) { input.disabled = true; input.value = 'Pinning…'; }

    try {
      // The expensive roster search is entirely local in IndexedDB. The server only receives
      // the minimum identity payload required to attach each student to the class.
      const classId = await this.getOrCreatePinnedClass(indexedClass.name);
      const payload = classStudents.map(student => ({
        externalRef: String(student.externalRef || student.id || student.upn || '').trim() || null,
        name: String(student.name || '').trim(),
        classId
      })).filter(student => student.name && student.externalRef);

      const response = await fetch('/api/students/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Class import failed');

      const pinned = JSON.parse(localStorage.getItem('pinnedClasses') || '[]');
      if (!pinned.includes(classId)) {
        pinned.push(classId);
        localStorage.setItem('pinnedClasses', JSON.stringify(pinned));
      }

      await window.app.loadGlobalData();
      await this.renderClassSettingsUI();
      if (!options.silentNotFound) window.app.showToast(`${indexedClass.name} pinned.`);
    } catch (error) {
      console.error(error);
      window.app.showToast(error.message || 'Could not pin class.', 'error');
    } finally {
      this.pinBusy = false;
      if (input) { input.disabled = false; input.value = ''; input.focus(); }
    }
  }
};
