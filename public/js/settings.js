window.settingsController = {
  tourStepIndex: 0,
  tourSteps: [
    { id: 'card-arbor', title: '1. Arbor roster', text: 'Upload the master spreadsheet so classes, student data and photos are available locally.' },
    { id: 'card-periods', title: '2. School day', text: 'Define your real lesson/break structure. The order here becomes the stable period key.' },
    { id: 'card-calendar', title: '3. A/B calendar', text: 'Set the Week A start and holidays so the Planbook calculates the correct cycle.' }
  ],

  async init() {
    // Shared periods/rooms are already hydrated by the SPA router.
    this.renderPeriodSettings();
    this.populateExistingSettings();
  },

  populateExistingSettings() {
    const user = window.app.currentUser || {};
    const theme = document.getElementById('setting-theme');
    const fontStyle = document.getElementById('setting-font-style');
    const fontSize = document.getElementById('setting-font-size');
    const provider = document.getElementById('setting-ai-provider');
    if (theme) theme.value = user.theme || localStorage.getItem('flowdesk-theme') || 'light';
    if (fontStyle) fontStyle.value = user.fontStyle || localStorage.getItem('flowdesk-font-style') || 'standard';
    if (fontSize) fontSize.value = user.fontSize || localStorage.getItem('flowdesk-font-size') || 'standard';
    if (provider) provider.value = user.aiProvider || 'openai';

    const term = document.getElementById('setting-term-start');
    const holidays = document.getElementById('setting-holidays');
    const termKey = user.termStart || localStorage.getItem('flowdesk-termStart') || '2026-08-31';
    const holidayKeys = (user.holidays ?? localStorage.getItem('flowdesk-holidays') ?? '').split(',').map(v => v.trim()).filter(Boolean);
    if (term) term.value = this.formatToUK(termKey);
    if (holidays) holidays.value = holidayKeys.map(v => this.formatToUK(v)).join(', ');

    const roomList = document.getElementById('settings-room-list');
    if (roomList) {
      roomList.innerHTML = (window.appState.rooms || []).length
        ? window.appState.rooms.map(room => `<li style="padding:6px 0; border-bottom:1px solid var(--border);">${window.app.escapeHTML(room.name)}</li>`).join('')
        : '<li style="color:var(--text-muted);">No rooms added yet.</li>';
    }
  },

  startTour() {
    this.tourStepIndex = 0;
    this.renderTourStep();
  },

  renderTourStep() {
    document.getElementById('flowdesk-tour')?.remove();
    if (this.tourStepIndex >= this.tourSteps.length) return this.endTour();
    const step = this.tourSteps[this.tourStepIndex];
    const target = document.getElementById(step.id);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const overlay = document.createElement('div');
    overlay.id = 'flowdesk-tour';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:100000; background:rgba(2,6,23,.72); display:flex; align-items:flex-end; justify-content:center; padding:28px;';
    overlay.innerHTML = `<div style="width:min(520px,95vw); background:var(--card); color:var(--text-main); border-radius:14px; padding:20px; box-shadow:var(--shadow-md);">
      <div style="font-weight:900; font-size:1.2em; margin-bottom:8px;">${step.title}</div>
      <p style="color:var(--text-muted); line-height:1.6;">${step.text}</p>
      <div style="display:flex; justify-content:space-between; align-items:center;"><button class="btn-outline" onclick="settingsController.endTour()">Close</button><button class="btn-primary" onclick="settingsController.nextTourStep()">${this.tourStepIndex === this.tourSteps.length - 1 ? 'Finish' : 'Next'} <i class="fas fa-arrow-right"></i></button></div>
    </div>`;
    document.body.appendChild(overlay);
  },

  nextTourStep() { this.tourStepIndex += 1; this.renderTourStep(); },
  endTour() { document.getElementById('flowdesk-tour')?.remove(); },

  sortPeriodsChronologically() {
    window.appState.rawPeriods = window.appState.rawPeriods || [];
    window.appState.rawPeriods.sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
    window.appState.rawPeriods.forEach((period, index) => { period.sortOrder = index + 1; });
  },

  renderPeriodSettings() {
    const container = document.getElementById('period-settings-list');
    if (!container) return;
    this.sortPeriodsChronologically();
    container.innerHTML = (window.appState.rawPeriods || []).map((period, index) => `
      <div style="display:grid; grid-template-columns:minmax(140px,2fr) minmax(105px,1fr) minmax(105px,1fr) minmax(120px,1fr) 40px; gap:8px; align-items:center;">
        <input type="text" class="form-control" value="${window.app.escapeHTML(period.label || '')}" placeholder="Period name" onchange="appState.rawPeriods[${index}].label=this.value">
        <input type="time" class="form-control" value="${period.startTime || '09:00'}" onchange="appState.rawPeriods[${index}].startTime=this.value">
        <input type="time" class="form-control" value="${period.endTime || '10:00'}" onchange="appState.rawPeriods[${index}].endTime=this.value">
        <select class="form-control" onchange="appState.rawPeriods[${index}].isBreak=this.value==='true'">
          <option value="false" ${period.isBreak ? '' : 'selected'}>Lesson</option>
          <option value="true" ${period.isBreak ? 'selected' : ''}>Break/Lunch</option>
        </select>
        <button type="button" class="btn-icon" style="color:var(--danger);" onclick="settingsController.removePeriodRow(${index})"><i class="fas fa-trash"></i></button>
      </div>`).join('');
  },

  addPeriodRow(isBreak) {
    const periods = window.appState.rawPeriods || (window.appState.rawPeriods = []);
    const last = [...periods].sort((a, b) => String(a.endTime).localeCompare(String(b.endTime))).at(-1);
    const startTime = last?.endTime || '09:00';
    const [hour, minute] = startTime.split(':').map(Number);
    const endTime = `${String((hour + (isBreak ? 0 : 1)) % 24).padStart(2, '0')}:${String(isBreak ? Math.min(59, minute + 20) : minute).padStart(2, '0')}`;
    periods.push({ label: isBreak ? 'Break' : 'New Period', startTime, endTime, isBreak: !!isBreak, sortOrder: periods.length + 1 });
    this.renderPeriodSettings();
  },

  removePeriodRow(index) {
    window.appState.rawPeriods.splice(index, 1);
    this.renderPeriodSettings();
  },

  async savePeriods(button) {
    const original = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    button.disabled = true;
    try {
      this.sortPeriodsChronologically();
      const response = await fetch('/api/periods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periods: window.appState.rawPeriods }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Failed to save periods');
      await window.app.loadGlobalData();
      this.renderPeriodSettings();
      window.app.showToast('School Day Structure Saved');
    } catch (error) { alert(error.message); }
    finally { button.innerHTML = original; button.disabled = false; }
  },

  formatToUK(ymd) {
    const match = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : String(ymd || '');
  },

  parseFromUK(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return '';
    return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  },

  async saveDataSettings(button) {
    const original = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    button.disabled = true;
    try {
      const termStart = this.parseFromUK(document.getElementById('setting-term-start').value);
      if (!termStart) throw new Error('Enter the term start as DD/MM/YYYY.');
      const holidays = document.getElementById('setting-holidays').value.split(',').map(value => this.parseFromUK(value)).filter(Boolean).join(',');
      const response = await fetch('/api/settings/calendar', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ termStart, holidays }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error?.message || 'Calendar save failed');
      localStorage.setItem('flowdesk-termStart', termStart);
      localStorage.setItem('flowdesk-holidays', holidays);
      window.termStart = window.app.parseLocalDate(termStart);
      window.holidays = holidays.split(',').filter(Boolean);
      if (window.app.currentUser) { window.app.currentUser.termStart = termStart; window.app.currentUser.holidays = holidays; }
      window.app.showToast('Calendar Saved');
    } catch (error) { alert(error.message); }
    finally { button.innerHTML = original; button.disabled = false; }
  },

  async saveAISettings(button) {
    const original = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    button.disabled = true;
    try {
      const provider = document.getElementById('setting-ai-provider').value;
      const apiKey = document.getElementById('setting-ai-key').value.trim();
      const response = await fetch('/api/settings/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, ...(apiKey ? { apiKey } : {}) }) });
      if (!response.ok) throw new Error('AI settings could not be saved.');
      if (window.app.currentUser) window.app.currentUser.aiProvider = provider;
      document.getElementById('setting-ai-key').value = '';
      window.app.showToast('AI Settings Saved');
    } catch (error) { alert(error.message); }
    finally { button.innerHTML = original; button.disabled = false; }
  },

  async addRoom() {
    const input = document.getElementById('new-room-input');
    const name = input.value.trim();
    if (!name) return;
    const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!response.ok) return window.app.showToast('Room could not be added');
    input.value = '';
    const rooms = await fetch('/api/rooms');
    if (rooms.ok) window.appState.rooms = await rooms.json();
    this.populateExistingSettings();
    window.app.showToast('Room Added');
  },

  normalizeBoolean(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'y', 'eligible', 'current', 'k', 'e', 's'].includes(raw) || (!!raw && !['0', 'false', 'no', 'n', 'none', 'not eligible'].includes(raw));
  },

  normalizeHeader(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  splitClasses(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    return String(value ?? '')
      .split(/[,;\n\r|]+/)
      .map(v => v.trim())
      .filter(Boolean);
  },

  findHeaderIndex(rows) {
    const nameHeaders = new Set(['name', 'student name', 'pupil name', 'legal name', 'full name', 'student', 'pupil']);
    const firstHeaders = new Set(['first name', 'forename', 'legal forename', 'preferred forename', 'preferred first name']);
    const lastHeaders = new Set(['last name', 'surname', 'legal surname', 'family name']);
    const classHeaders = new Set(['courses classes', 'course classes', 'classes', 'class', 'teaching groups', 'teaching group', 'class codes', 'class code']);
    const yearHeaders = new Set(['year group', 'year', 'yeargroup']);
    const idHeaders = new Set(['upn', 'student id', 'pupil id', 'student number', 'pupil number', 'admission number', 'person id']);

    let bestIndex = -1;
    let bestScore = -1;
    const limit = Math.min(rows.length, 60);

    for (let i = 0; i < limit; i += 1) {
      const headers = (rows[i] || []).map(value => this.normalizeHeader(value)).filter(Boolean);
      if (!headers.length) continue;

      const hasName = headers.some(h => nameHeaders.has(h));
      const hasFirst = headers.some(h => firstHeaders.has(h));
      const hasLast = headers.some(h => lastHeaders.has(h));
      const hasClass = headers.some(h => classHeaders.has(h) || h.includes('courses classes') || h.includes('teaching groups'));
      const hasYear = headers.some(h => yearHeaders.has(h) || h.startsWith('year group '));
      const hasId = headers.some(h => idHeaders.has(h));

      // A valid Arbor header must identify a pupil by full name OR by first/surname columns.
      if (!(hasName || (hasFirst && hasLast))) continue;
      const score = (hasName ? 4 : 0) + (hasFirst ? 2 : 0) + (hasLast ? 2 : 0) + (hasClass ? 4 : 0) + (hasYear ? 1 : 0) + (hasId ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  },

  findColumn(headers, exactAliases, containsAliases = []) {
    const exact = exactAliases.map(value => this.normalizeHeader(value));
    const contains = containsAliases.map(value => this.normalizeHeader(value));

    // Exact matching first is intentional. Generic words such as "name" and "class"
    // must never accidentally bind to "Class Name" or "Class Teacher".
    for (const alias of exact) {
      const index = headers.findIndex(header => header === alias);
      if (index >= 0) return index;
    }
    for (const alias of contains) {
      const index = headers.findIndex(header => header.includes(alias));
      if (index >= 0) return index;
    }
    return -1;
  },

  mapArborColumns(headerRow) {
    const headers = (headerRow || []).map(value => this.normalizeHeader(value));
    return {
      name: this.findColumn(headers, ['student name', 'pupil name', 'legal name', 'full name', 'name', 'student', 'pupil']),
      first: this.findColumn(headers, ['first name', 'forename', 'legal forename', 'preferred forename', 'preferred first name']),
      last: this.findColumn(headers, ['last name', 'surname', 'legal surname', 'family name']),
      year: this.findColumn(headers, ['year group', 'year', 'yeargroup'], ['year group']),
      classes: this.findColumn(
        headers,
        ['courses classes', 'course classes', 'classes', 'class', 'teaching groups', 'teaching group', 'class codes', 'class code'],
        ['courses classes', 'course classes', 'teaching groups', 'class codes']
      ),
      gender: this.findColumn(headers, ['gender', 'sex', 'legal gender']),
      id: this.findColumn(headers, ['upn', 'student id', 'pupil id', 'student number', 'pupil number', 'admission number', 'person id']),
      sen: this.findColumn(headers, ['sen status', 'sen', 'send status', 'send'], ['sen status', 'send status']),
      pp: this.findColumn(headers, ['pupil premium', 'pp', 'pupil premium status'], ['pupil premium']),
      fsm: this.findColumn(headers, ['free school meals', 'fsm', 'fsm eligible', 'free school meal'], ['free school meal']),
      cat: this.findColumn(headers, ['cat mean', 'cat score', 'cat'], ['cat mean'])
    };
  },

  parseMasterRows(rows, imageMap = {}) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('The spreadsheet contains no readable rows.');

    const headerIndex = this.findHeaderIndex(rows);
    if (headerIndex < 0) {
      throw new Error('Could not find the Arbor pupil header row. Expected Student Name/Name or First Name + Surname.');
    }

    const columns = this.mapArborColumns(rows[headerIndex]);
    if (columns.name < 0 && (columns.first < 0 || columns.last < 0)) {
      throw new Error('Could not map the pupil name columns in the Arbor file.');
    }

    const roster = [];
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = rows[index] || [];
      const cell = col => col >= 0 && row[col] != null ? String(row[col]).trim() : '';

      let name = cell(columns.name);
      const first = cell(columns.first);
      const last = cell(columns.last);
      if (!name && (first || last)) name = [last, first].filter(Boolean).join(', ');
      if (!name) continue;

      const externalRef = cell(columns.id) || `${name.replace(/\s+/g, '-')}-${index}`;
      const gender = cell(columns.gender);
      const classTokens = columns.classes >= 0 ? this.splitClasses(row[columns.classes]) : [];
      const year = cell(columns.year);

      roster.push({
        id: externalRef,
        externalRef,
        name,
        year,
        yearGroup: year,
        classes: classTokens.join(', '),
        gender,
        sex: gender,
        sen: columns.sen >= 0 ? this.normalizeBoolean(row[columns.sen]) : false,
        pp: columns.pp >= 0 ? this.normalizeBoolean(row[columns.pp]) : false,
        fsm: columns.fsm >= 0 ? this.normalizeBoolean(row[columns.fsm]) : false,
        catMean: cell(columns.cat),
        photo: imageMap[index] || null
      });
    }

    if (!roster.length) throw new Error('The Arbor header was found, but no pupil rows could be read.');

    const uniqueClasses = [...new Set(roster.flatMap(student => this.splitClasses(student.classes)))].filter(Boolean);
    return { roster, uniqueClasses, headerIndex, columns };
  },

  async extractExcelImages(file) {
    if (!/\.xlsx$/i.test(file.name)) return {};
    try {
      const zip = await JSZip.loadAsync(file);
      const drawings = Object.keys(zip.files).filter(name => /^xl\/drawings\/drawing\d+\.xml$/i.test(name));
      const finalImages = {};
      for (const drawingPath of drawings) {
        const relPath = drawingPath.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels';
        const drawingFile = zip.file(drawingPath);
        const relFile = zip.file(relPath);
        if (!drawingFile || !relFile) continue;
        const [drawingText, relText] = await Promise.all([drawingFile.async('text'), relFile.async('text')]);
        const relations = {};
        for (const match of relText.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
          relations[match[1]] = match[2].replace(/^\.\.\//, 'xl/');
        }
        const anchors = drawingText.split(/<xdr:(?:twoCellAnchor|oneCellAnchor)>/i).slice(1);
        for (const anchor of anchors) {
          const rowMatch = anchor.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/i);
          const embedMatch = anchor.match(/<a:blip[^>]*r:embed="([^"]+)"/i);
          if (!rowMatch || !embedMatch) continue;
          const imagePath = relations[embedMatch[1]];
          const imageFile = imagePath ? zip.file(imagePath) : null;
          if (!imageFile) continue;
          const base64 = await imageFile.async('base64');
          const extension = imagePath.split('.').pop().toLowerCase();
          const mime = extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : 'image/jpeg';
          finalImages[Number(rowMatch[1])] = `data:${mime};base64,${base64}`;
        }
      }
      return finalImages;
    } catch (error) {
      console.warn('Image extraction failed', error);
      return {};
    }
  },

  async handleMasterFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const output = document.getElementById('master-csv-output');
    const progress = document.getElementById('import-progress-container');
    const fill = document.getElementById('import-progress-fill');
    if (!output || !progress || !fill) return;

    progress.style.display = 'block';
    fill.style.width = '8%';
    fill.textContent = '8%';
    output.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reading Arbor pupil and class data…';

    try {
      if (typeof XLSX === 'undefined') throw new Error('The spreadsheet reader did not load. Refresh FlowDesk and try the file again.');

      const [arrayBuffer, imageMap] = await Promise.all([file.arrayBuffer(), this.extractExcelImages(file)]);
      fill.style.width = '45%';
      fill.textContent = '45%';

      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      if (!workbook.SheetNames?.length) throw new Error('No worksheet was found in the selected file.');
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, raw: false });
      const parsed = this.parseMasterRows(rows, imageMap);

      fill.style.width = '72%';
      fill.textContent = '72%';

      const saved = await window.idb.set('wholeSchoolRoster', parsed.roster);
      if (!saved) throw new Error('FlowDesk could not save the Arbor roster to local storage.');
      await window.idb.set('rosterVersion', `${Date.now()}`);
      await window.idb.delete('nt_progress');

      // Force all consumers to discard any empty roster index cached before this upload.
      if (window.timetableController) {
        window.timetableController.rosterCache = null;
        window.timetableController.rosterClassIndex = null;
        window.timetableController.lastAutoPinned = '';
      }

      // Verify the exact data that Timetable/Name Trainer will read back.
      const verified = await window.idb.get('wholeSchoolRoster') || [];
      if (verified.length !== parsed.roster.length) {
        throw new Error(`Roster verification failed: saved ${parsed.roster.length}, read back ${verified.length}.`);
      }

      fill.style.width = '100%';
      fill.textContent = '100%';
      const classText = parsed.uniqueClasses.length === 1 ? '1 class detected' : `${parsed.uniqueClasses.length} classes detected`;
      output.innerHTML = `<span style="color:var(--success);"><i class="fas fa-check-circle"></i> ${verified.length} students loaded • ${classText} • ${Object.keys(imageMap).length} photos extracted.</span>`;
      window.app.showToast(`Arbor loaded: ${verified.length} students, ${parsed.uniqueClasses.length} classes`);
      setTimeout(() => { progress.style.display = 'none'; }, 3000);
    } catch (error) {
      console.error('Arbor import failed', error);
      output.innerHTML = `<span style="color:var(--danger);"><i class="fas fa-triangle-exclamation"></i> ${window.app.escapeHTML(error.message || 'Arbor import failed.')}</span>`;
      progress.style.display = 'none';
    } finally {
      // Allow selecting the same file again after an error/fix without choosing a different file first.
      if (event.target) event.target.value = '';
    }
  },

  async wipeRostersOnly() {
    if (!confirm('Wipe your students, classes, seating plans, lesson links and timetables?')) return;
    const button = document.getElementById('wipe-btn');
    const original = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wiping…'; button.disabled = true;
    try {
      const response = await fetch('/api/auth/nuke-rosters', { method: 'POST' });
      if (!response.ok) throw new Error('Database wipe failed.');
      await window.idb.set('wholeSchoolRoster', []);
      await window.idb.delete('nt_progress');
      localStorage.removeItem('pinnedClasses');
      await window.app.hydrateCoreState();
      window.app.showToast('Your roster data was cleared');
    } catch (error) { alert(error.message); }
    finally { button.innerHTML = original; button.disabled = false; }
  }
};
