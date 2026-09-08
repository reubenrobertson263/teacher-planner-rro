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

  async addRoom(button) {
    const input = document.getElementById('new-room-input');
    const name = input?.value.trim();
    if (!name || !button) return;
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding…';
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Room could not be added');
      input.value = '';
      await window.app.loadGlobalData();
      this.populateExistingSettings();
      window.app.showToast('Room Added');
    } catch (error) {
      window.app.showToast(error.message || 'Room could not be added');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  },

  normalizeBoolean(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return false;
    const negatives = ['0', 'false', 'no', 'n', 'none', 'not eligible', 'not current', 'not pupil premium', 'not pp', 'not fsm', 'not eligible for free school meals', 'not eligible for fsm', 'no special educational need', 'no sen', 'no send', 'not sen', 'not send'];
    if (negatives.includes(raw)) return false;
    return ['1', 'true', 'yes', 'y', 'eligible', 'current', 'k', 'e', 's'].includes(raw) || raw.length > 0;
  },

  parseArborClassCodes(value) {
    const raw = String(value ?? '').replace(/\u00a0/g, ' ').trim();
    if (!raw) return [];
    const direct = [...raw.matchAll(/\b\d{1,2}[A-Za-z0-9]{0,5}\/[A-Za-z][A-Za-z0-9._-]{0,15}\b/g)].map(match => match[0].trim());
    if (direct.length) return [...new Set(direct)];
    const fallback = [];
    raw.split(/[,;\n|]+/).forEach(section => {
      let candidate = String(section || '').trim();
      if (!candidate) return;
      candidate = candidate.split(':').pop().trim().replace(/\([^)]*\)/g, '').trim();
      if (!candidate || /^year\s*\d+/i.test(candidate)) return;
      if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(candidate)) fallback.push(candidate);
    });
    return [...new Set(fallback)];
  },

  setImportProgress(value, message = '') {
    const progress = document.getElementById('import-progress-container');
    const fill = document.getElementById('import-progress-fill');
    const output = document.getElementById('master-csv-output');
    if (progress) progress.style.display = 'block';
    if (fill) {
      const safe = Math.max(0, Math.min(100, Number(value) || 0));
      fill.style.width = `${safe}%`;
      fill.textContent = `${safe}%`;
    }
    if (output && message) output.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${window.app.escapeHTML(message)}`;
  },

  async yieldToBrowser() {
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  },

  resolveZipTarget(drawingPath, target) {
    const rawTarget = String(target || '').replace(/\\/g, '/').replace(/^\//, '');
    if (!rawTarget) return '';
    const parts = drawingPath.split('/');
    parts.pop();
    rawTarget.split('/').forEach(part => {
      if (!part || part === '.') return;
      if (part === '..') parts.pop();
      else parts.push(part);
    });
    return parts.join('/');
  },

  async extractExcelImagesFallback(arrayBuffer, fileName, onProgress = () => {}) {
    if (!/\.xlsx$/i.test(fileName || '') || !window.JSZip) return {};
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    const drawings = Object.keys(zip.files).filter(name => /^xl\/drawings\/drawing\d+\.xml$/i.test(name));
    const finalImages = {};
    let processed = 0;

    for (let drawingIndex = 0; drawingIndex < drawings.length; drawingIndex += 1) {
      const drawingPath = drawings[drawingIndex];
      const drawingName = drawingPath.split('/').pop();
      const relPath = `xl/drawings/_rels/${drawingName}.rels`;
      const drawingFile = zip.file(drawingPath);
      const relFile = zip.file(relPath);
      if (!drawingFile || !relFile) continue;
      const [drawingText, relText] = await Promise.all([drawingFile.async('text'), relFile.async('text')]);
      const relations = {};
      for (const tag of relText.matchAll(/<Relationship\b[^>]*>/gi)) {
        const idMatch = tag[0].match(/\bId="([^"]+)"/i);
        const targetMatch = tag[0].match(/\bTarget="([^"]+)"/i);
        if (!idMatch || !targetMatch) continue;
        relations[idMatch[1]] = this.resolveZipTarget(drawingPath, targetMatch[1]);
      }
      const anchors = drawingText.split(/<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>/i).slice(1);
      for (const anchor of anchors) {
        const rowMatch = anchor.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/i);
        const embedMatch = anchor.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/i);
        if (!rowMatch || !embedMatch) continue;
        const imagePath = relations[embedMatch[1]];
        const imageFile = imagePath ? zip.file(imagePath) : null;
        if (!imageFile) continue;
        const base64 = await imageFile.async('base64');
        const extension = imagePath.split('.').pop().toLowerCase();
        const mime = extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
        finalImages[Number(rowMatch[1])] = `data:${mime};base64,${base64}`;
        processed += 1;
        if (processed % 12 === 0) {
          onProgress(Math.min(72, 38 + Math.round((drawingIndex + 1) / Math.max(1, drawings.length) * 30)), `Extracted ${processed} profile photos…`);
          await this.yieldToBrowser();
        }
      }
    }
    return finalImages;
  },

  locateArborColumns(rows) {
    const normalise = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const aliases = new Set(['name', 'student name', 'legal name', 'first name', 'legal forename', 'forename']);
    let headerIndex = -1;
    for (let index = 0; index < Math.min(rows.length, 80); index += 1) {
      if ((rows[index] || []).some(cell => aliases.has(normalise(cell)))) { headerIndex = index; break; }
    }
    if (headerIndex < 0) throw new Error('Could not find the Arbor student header row. Check that this is the master student export.');
    const headers = (rows[headerIndex] || []).map(normalise);
    const find = names => headers.findIndex(header => names.some(name => header === name || header.includes(name)));
    return {
      headerIndex,
      columns: {
        name: find(['student name', 'legal name', 'full name', 'name']), first: find(['first name', 'legal forename', 'forename']),
        last: find(['last name', 'legal surname', 'surname']), year: find(['year group', 'year']),
        classes: find(['courses classes', 'courses class', 'classes', 'class memberships', 'class']), gender: find(['gender', 'sex']),
        id: find(['upn', 'student id', 'pupil id', 'external id', 'id']), sen: find(['sen status', 'send status', 'sen']),
        pp: find(['pupil premium', 'pp']), fsm: find(['free school meals', 'fsm']), cat: find(['cat mean', 'cat score', 'cat'])
      }
    };
  },

  buildArborRoster(rows, imageMap) {
    const { headerIndex, columns } = this.locateArborColumns(rows);
    const roster = [];
    const classes = new Set();
    for (let index = headerIndex + 1; index < rows.length; index += 1) {
      const row = Array.isArray(rows[index]) ? rows[index] : [];
      if (!row.length) continue;
      let name = columns.name >= 0 ? String(row[columns.name] ?? '').trim() : '';
      const first = columns.first >= 0 ? String(row[columns.first] ?? '').trim() : '';
      const last = columns.last >= 0 ? String(row[columns.last] ?? '').trim() : '';
      if (!name && (first || last)) name = [first, last].filter(Boolean).join(' ');
      if (!name) continue;
      const rawId = columns.id >= 0 ? String(row[columns.id] ?? '').trim() : '';
      const id = rawId || `local-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const gender = columns.gender >= 0 ? String(row[columns.gender] ?? '').trim() : '';
      const classList = columns.classes >= 0 ? this.parseArborClassCodes(row[columns.classes]) : [];
      classList.forEach(code => classes.add(code));
      const year = columns.year >= 0 ? String(row[columns.year] ?? '').trim() : '';
      roster.push({
        id, externalRef: id, name, firstName: first, surname: last, year, yearGroup: year,
        classes: classList.join(', '), classList, gender, sex: gender,
        sen: columns.sen >= 0 ? this.normalizeBoolean(row[columns.sen]) : false,
        pp: columns.pp >= 0 ? this.normalizeBoolean(row[columns.pp]) : false,
        fsm: columns.fsm >= 0 ? this.normalizeBoolean(row[columns.fsm]) : false,
        catMean: columns.cat >= 0 ? String(row[columns.cat] ?? '').trim() : '', photo: imageMap[index] || null
      });
    }
    if (!roster.length) throw new Error('No student rows were found in the Arbor spreadsheet.');
    return { roster, classCount: classes.size };
  },

  async parseMasterFileFallback(file, onProgress) {
    if (!window.XLSX) throw new Error('The Excel parser is not available. Refresh FlowDesk and try again.');
    onProgress(10, 'Reading spreadsheet…');
    const arrayBuffer = await file.arrayBuffer();
    await this.yieldToBrowser();
    const workbook = window.XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
    if (!workbook.SheetNames?.length) throw new Error('The spreadsheet contains no worksheets.');
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '', raw: false, blankrows: true });
    onProgress(30, `Read ${Math.max(0, rows.length - 1)} spreadsheet rows…`);
    await this.yieldToBrowser();
    const imageMap = await this.extractExcelImagesFallback(arrayBuffer, file.name, onProgress);
    onProgress(80, 'Matching classes and student data…');
    await this.yieldToBrowser();
    const result = this.buildArborRoster(rows, imageMap);
    return { ...result, photoCount: Object.keys(imageMap).length };
  },

  async parseMasterFileInWorker(file, onProgress) {
    if (!window.Worker) throw new Error('Web Workers are not supported by this browser.');
    const arrayBuffer = await file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const worker = new Worker('/js/arbor-worker.js?v=20260907');
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('The background Arbor import timed out.'));
      }, 180000);
      worker.onmessage = event => {
        const data = event.data || {};
        if (data.type === 'progress') return onProgress(data.value, data.message);
        clearTimeout(timeout);
        worker.terminate();
        if (data.type === 'done') resolve(data);
        else reject(new Error(data.message || 'Arbor import failed.'));
      };
      worker.onerror = event => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || 'The background Arbor importer could not start.'));
      };
      worker.postMessage({ arrayBuffer, fileName: file.name }, [arrayBuffer]);
    });
  },

  async handleMasterFile(event) {
    const input = event.currentTarget || event.target;
    const file = input?.files?.[0];
    if (!file) return;
    const output = document.getElementById('master-csv-output');
    const progress = document.getElementById('import-progress-container');
    const extensionOK = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!extensionOK) {
      if (output) output.innerHTML = '<span style="color:var(--danger);"><i class="fas fa-triangle-exclamation"></i> Choose an Arbor .xlsx, .xls or .csv export.</span>';
      return;
    }

    input.disabled = true;
    this.setImportProgress(5, 'Starting background Arbor import…');
    try {
      let result;
      try {
        result = await this.parseMasterFileInWorker(file, (value, message) => this.setImportProgress(value, message));
      } catch (workerError) {
        console.warn('Arbor worker unavailable; using yielding fallback.', workerError);
        this.setImportProgress(7, 'Using compatibility importer…');
        result = await this.parseMasterFileFallback(file, (value, message) => this.setImportProgress(value, message));
      }

      this.setImportProgress(92, `Saving ${result.roster.length} students locally…`);
      await this.yieldToBrowser();
      const saved = await window.idb.set('wholeSchoolRoster', result.roster);
      if (!saved) throw new Error('The browser could not save the roster to IndexedDB. Check available storage and try again.');
      await window.idb.set('rosterVersion', `${Date.now()}`);
      await window.idb.delete('nt_progress');
      await window.app.loadGlobalData();

      this.setImportProgress(100, 'Arbor import complete.');
      if (output) output.innerHTML = `<span style="color:var(--success);"><i class="fas fa-check-circle"></i> ${result.roster.length} students loaded • ${result.classCount || 0} classes found • ${result.photoCount || 0} profile photos extracted.</span>`;
      window.app.showToast('Arbor Master File Loaded');
      setTimeout(() => { if (progress) progress.style.display = 'none'; }, 2600);
    } catch (error) {
      console.error(error);
      if (output) output.innerHTML = `<span style="color:var(--danger);"><i class="fas fa-triangle-exclamation"></i> ${window.app.escapeHTML(error.message)}</span>`;
      if (progress) progress.style.display = 'none';
    } finally {
      input.disabled = false;
      input.value = '';
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
