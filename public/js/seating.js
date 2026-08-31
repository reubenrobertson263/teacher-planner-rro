window.seatingController = {
  undoStack: [],
  noiseStream: null,
  audioContext: null,
  mediaSource: null,
  analyser: null,
  silentGain: null,
  noiseRAF: null,
  privacyVisible: true,
  DESK_W: 110,
  DESK_H: 65,
  currentClassId: '',
  currentRoomId: '',
  dirty: false,
  autoSaveTimer: null,
  beforeUnloadHandler: null,

  async init() {
    await window.app.coreDataReady;
    const [classRes, roomRes] = await Promise.all([fetch('/api/classes'), fetch('/api/rooms')]);
    if (classRes.ok) window.appState.classes = await classRes.json();
    if (roomRes.ok) window.appState.rooms = await roomRes.json();
    if (!(window.appState.rooms || []).length) {
      const created = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Default Classroom' }) });
      if (created.ok) window.appState.rooms = [await created.json()];
    }
    this.populateSelectors();
    window.appState.desks ||= [];
    window.appState.furniture ||= [];
    window.appState.seatingStudents = [];
    this.currentRoomId = document.getElementById('seating-room-select')?.value || '';
    this.currentClassId = '';
    this.dirty = false;
    this.beforeUnloadHandler = event => {
      if (!this.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    this.renderSeatingCanvas();
    this.renderSeatingPool();
  },

  async destroy() {
    clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = null;
    if (this.dirty && this.currentClassId && this.currentRoomId) await this.saveLayout(null, { silent: true });
    if (this.beforeUnloadHandler) window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    this.beforeUnloadHandler = null;
    await this.stopNoiseMeter();
    document.body.classList.remove('projector-active');
  },

  populateSelectors() {
    const esc = window.app.escapeHTML;
    const classSelect = document.getElementById('seating-class-select');
    const roomSelect = document.getElementById('seating-room-select');
    if (classSelect) classSelect.innerHTML = '<option value="">Select class…</option>' + (window.appState.classes || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    if (roomSelect) roomSelect.innerHTML = (window.appState.rooms || []).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
  },

  markDirty() {
    this.dirty = true;
    clearTimeout(this.autoSaveTimer);
    if (this.currentClassId && this.currentRoomId) {
      this.autoSaveTimer = setTimeout(() => this.saveLayout(null, { silent: true }), 900);
    }
  },

  async loadSelectedSeatingPlan() {
    const classId = document.getElementById('seating-class-select')?.value || '';
    const roomId = document.getElementById('seating-room-select')?.value || '';
    const cls = (window.appState.classes || []).find(c => c.id === classId);

    // Save the plan that is being left before changing class/room.
    if (this.dirty && this.currentClassId && this.currentRoomId && (classId !== this.currentClassId || roomId !== this.currentRoomId)) {
      await this.saveLayout(null, { silent: true, classId: this.currentClassId, roomId: this.currentRoomId });
    }

    const previousClassId = this.currentClassId;
    const previousRoomId = this.currentRoomId;
    const sameRoom = !!roomId && roomId === previousRoomId;
    const retainedDesks = structuredClone(window.appState.desks || []);
    const retainedFurniture = structuredClone(window.appState.furniture || []);

    this.currentClassId = classId;
    this.currentRoomId = roomId;
    window.appState.seatingStudents = [];

    if (!cls || !roomId) {
      // Class changes never destroy the physical room geometry.
      window.appState.desks = retainedDesks;
      window.appState.furniture = retainedFurniture;
      this.dirty = false;
      this.renderSeatingCanvas();
      this.renderSeatingPool();
      return;
    }

    const canvas = document.getElementById('seating-canvas');
    if (canvas) canvas.classList.add('is-loading');
    try {
      const response = await fetch(`/api/seating?classId=${encodeURIComponent(classId)}&roomId=${encodeURIComponent(roomId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not retrieve seating plan.');
      const plans = await response.json();
      const plan = plans[0] || null;
      const layout = plan?.layoutData || {};

      const retainCurrentGeometry = sameRoom && retainedDesks.length > 0 && (previousClassId || this.dirty);
      if (retainCurrentGeometry) {
        // Critical rule: switching class in the same physical room retains desks/furniture. Only pupil assignments are reset/reloaded.
        window.appState.desks = retainedDesks;
        window.appState.furniture = retainedFurniture;
      } else {
        // For a different room, use this class's saved geometry; otherwise borrow the latest geometry saved for that room.
        let geometry = layout;
        if (!Array.isArray(geometry.desks) || !geometry.desks.length) {
          const roomPlansResponse = await fetch(`/api/seating?roomId=${encodeURIComponent(roomId)}`, { cache: 'no-store' });
          const roomPlans = roomPlansResponse.ok ? await roomPlansResponse.json() : [];
          geometry = roomPlans.find(item => Array.isArray(item.layoutData?.desks) && item.layoutData.desks.length)?.layoutData || {};
        }
        window.appState.desks = Array.isArray(geometry.desks) ? geometry.desks.map(d => ({ ...d, x: Number(d.x) || 0, y: Number(d.y) || 0 })) : [];
        window.appState.furniture = Array.isArray(geometry.furniture) ? geometry.furniture.map(f => ({ ...f, x: Number(f.x) || 0, y: Number(f.y) || 0 })) : [];
      }

      const validDeskIds = new Set((window.appState.desks || []).map(d => d.id));
      const savedAssignments = new Map((Array.isArray(layout.students) ? layout.students : []).map(s => [s.id, validDeskIds.has(s.deskId) ? s.deskId : null]));
      window.appState.seatingStudents = (cls.students || []).map(student => ({ ...student, deskId: savedAssignments.get(student.id) || null }));
      this.undoStack = [];
      this.dirty = false;
      this.renderSeatingCanvas();
      this.renderSeatingPool();
      if (plan) window.app.showToast('Saved seating plan loaded.');
    } catch (error) {
      console.error(error);
      window.appState.desks = retainedDesks;
      window.appState.furniture = retainedFurniture;
      window.appState.seatingStudents = (cls.students || []).map(student => ({ ...student, deskId: null }));
      this.renderSeatingCanvas();
      this.renderSeatingPool();
      window.app.showToast(error.message, 'error');
    } finally {
      if (canvas) canvas.classList.remove('is-loading');
    }
  },

  async saveLayout(button = null, options = {}) {
    const classId = options.classId || this.currentClassId || document.getElementById('seating-class-select')?.value;
    const roomId = options.roomId || this.currentRoomId || document.getElementById('seating-room-select')?.value;
    if (!classId || !roomId) {
      if (!options.silent) window.app.showToast('Select a class and room first.', 'error');
      return false;
    }
    const original = button?.innerHTML;
    if (button) { button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }
    try {
      const payload = {
        classId, roomId,
        layoutData: {
          desks: (window.appState.desks || []).map(d => ({ id: d.id, x: Number(d.x), y: Number(d.y) })),
          furniture: (window.appState.furniture || []).map(f => ({ id: f.id, type: f.type, x: Number(f.x), y: Number(f.y) })),
          students: (window.appState.seatingStudents || []).map(s => ({ id: s.id, deskId: s.deskId || null }))
        }
      };
      const response = await fetch('/api/seating', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: !!options.keepalive });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error?.message || 'Save failed');
      this.dirty = false;
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
      if (!options.silent) window.app.showToast('Seating plan saved.');
      return true;
    } catch (error) {
      console.error(error);
      this.dirty = true;
      if (!options.silent) window.app.showToast(error.message, 'error');
      return false;
    } finally {
      if (button) { button.disabled = false; button.innerHTML = original; }
    }
  },

  saveStateToHistory() {
    this.undoStack.push({
      desks: structuredClone(window.appState.desks || []),
      furniture: structuredClone(window.appState.furniture || []),
      seatingStudents: structuredClone(window.appState.seatingStudents || [])
    });
    if (this.undoStack.length > 40) this.undoStack.shift();
  },

  undo() {
    const state = this.undoStack.pop();
    if (!state) return window.app.showToast('Nothing to undo.');
    Object.assign(window.appState, state);
    this.markDirty();
    this.renderSeatingCanvas(); this.renderSeatingPool();
  },

  uniqueId(prefix) { return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; },
  addDesk() { this.saveStateToHistory(); (window.appState.desks ||= []).push({ id: this.uniqueId('desk'), x: 70, y: 70 }); this.markDirty(); this.renderSeatingCanvas(); },
  addFurniture(type) { this.saveStateToHistory(); (window.appState.furniture ||= []).push({ id: this.uniqueId('furn'), type, x: type === 'whiteboard' ? 260 : 70, y: type === 'whiteboard' ? 20 : 180 }); this.markDirty(); this.renderSeatingCanvas(); },

  clearDesks() {
    if (!confirm('Wipe all desks and furniture for this layout?')) return;
    this.saveStateToHistory(); window.appState.desks = []; window.appState.furniture = [];
    (window.appState.seatingStudents || []).forEach(s => { s.deskId = null; });
    this.markDirty(); this.renderSeatingCanvas(); this.renderSeatingPool();
  },

  furnitureSize(item) { return item.type === 'whiteboard' ? { w: 200, h: 24 } : { w: 130, h: 62 }; },

  flipRoom() {
    const desks = window.appState.desks || [];
    if (!desks.length) return window.app.showToast('Add desks before flipping the room.', 'error');
    this.saveStateToHistory();
    const minX = Math.min(...desks.map(d => Number(d.x)));
    const minY = Math.min(...desks.map(d => Number(d.y)));
    const maxX = Math.max(...desks.map(d => Number(d.x) + this.DESK_W));
    const maxY = Math.max(...desks.map(d => Number(d.y) + this.DESK_H));
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    desks.forEach(desk => {
      const objectCentreX = Number(desk.x) + this.DESK_W / 2;
      const objectCentreY = Number(desk.y) + this.DESK_H / 2;
      desk.x = Math.round((2 * centreX - objectCentreX) - this.DESK_W / 2);
      desk.y = Math.round((2 * centreY - objectCentreY) - this.DESK_H / 2);
    });
    (window.appState.furniture || []).forEach(item => {
      const { w, h } = this.furnitureSize(item);
      const objectCentreX = Number(item.x) + w / 2;
      const objectCentreY = Number(item.y) + h / 2;
      item.x = Math.round((2 * centreX - objectCentreX) - w / 2);
      item.y = Math.round((2 * centreY - objectCentreY) - h / 2);
    });
    this.markDirty(); this.renderSeatingCanvas();
    window.app.showToast('Room flipped 180° around the desk-cluster centre.');
  },

  unseatAll(recordHistory = true) {
    if (recordHistory) this.saveStateToHistory();
    (window.appState.seatingStudents || []).forEach(s => { s.deskId = null; });
    this.markDirty(); this.renderSeatingCanvas(); this.renderSeatingPool();
  },

  autoSeat() {
    this.saveStateToHistory();
    const unassigned = (window.appState.seatingStudents || []).filter(s => !s.deskId);
    (window.appState.desks || []).forEach(desk => {
      if (!(window.appState.seatingStudents || []).some(s => s.deskId === desk.id) && unassigned.length) unassigned.shift().deskId = desk.id;
    });
    this.markDirty(); this.renderSeatingCanvas(); this.renderSeatingPool();
  },

  normalizedGender(student) {
    const raw = String(student?.gender ?? student?.sex ?? '').trim().toLowerCase();
    if (raw === 'm' || raw === 'male') return 'M';
    if (raw === 'f' || raw === 'female') return 'F';
    return 'O';
  },

  alternateBoyGirl() {
    this.saveStateToHistory();
    (window.appState.seatingStudents || []).forEach(s => { s.deskId = null; });
    const students = window.appState.seatingStudents || [];
    const boys = students.filter(s => this.normalizedGender(s) === 'M');
    const girls = students.filter(s => this.normalizedGender(s) === 'F');
    const other = students.filter(s => this.normalizedGender(s) === 'O');
    const arranged = [];
    let nextGender = boys.length >= girls.length ? 'M' : 'F';
    while (boys.length || girls.length) {
      if (nextGender === 'M') {
        if (boys.length) arranged.push(boys.shift());
        else if (girls.length) arranged.push(girls.shift());
        nextGender = 'F';
      } else {
        if (girls.length) arranged.push(girls.shift());
        else if (boys.length) arranged.push(boys.shift());
        nextGender = 'M';
      }
    }
    arranged.push(...other);
    (window.appState.desks || []).forEach((desk, index) => { if (arranged[index]) arranged[index].deskId = desk.id; });
    this.markDirty(); this.renderSeatingCanvas(); this.renderSeatingPool();
    window.app.showToast(`B/G alternating applied: ${students.filter(s => this.normalizedGender(s) === 'M').length} male, ${students.filter(s => this.normalizedGender(s) === 'F').length} female.`);
  },

  allowDrop(event) { event.preventDefault(); },

  dragEntity(event, id, type) {
    event.stopPropagation(); event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify({ id, type }));
    const rect = event.currentTarget.getBoundingClientRect();
    event.dataTransfer.setData('offsetX', String(event.clientX - rect.left));
    event.dataTransfer.setData('offsetY', String(event.clientY - rect.top));
  },

  readDrag(event) {
    try { return JSON.parse(event.dataTransfer.getData('application/json')); }
    catch { return { id: event.dataTransfer.getData('id'), type: event.dataTransfer.getData('type') }; }
  },

  dropOnDesk(event, deskId) {
    event.preventDefault(); event.stopPropagation();
    const { id, type } = this.readDrag(event);
    if (type !== 'student') return;
    const student = (window.appState.seatingStudents || []).find(s => s.id === id);
    if (!student) return;
    this.saveStateToHistory();
    const studentADeskId = student.deskId || null;
    const studentB = (window.appState.seatingStudents || []).find(s => s.id !== student.id && s.deskId === deskId);
    // True swap: desks never move. A takes B's deskId; B takes A's previous deskId.
    student.deskId = deskId;
    if (studentB) studentB.deskId = studentADeskId;
    this.markDirty(); this.renderSeatingCanvas(); this.renderSeatingPool();
  },

  dropToCanvasVoid(event) {
    event.preventDefault();
    const { id, type } = this.readDrag(event);
    const canvas = document.getElementById('seating-canvas'); if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = Number(event.dataTransfer.getData('offsetX')) || 0;
    const offsetY = Number(event.dataTransfer.getData('offsetY')) || 0;
    const x = Math.round(Math.max(0, event.clientX - rect.left - offsetX));
    const y = Math.round(Math.max(0, event.clientY - rect.top - offsetY));
    this.saveStateToHistory();
    if (type === 'desk') {
      const item = (window.appState.desks || []).find(d => d.id === id); if (item) { item.x = x; item.y = y; }
    } else if (type === 'furniture') {
      const item = (window.appState.furniture || []).find(f => f.id === id); if (item) { item.x = x; item.y = y; }
    } else if (type === 'student') {
      const student = (window.appState.seatingStudents || []).find(s => s.id === id); if (student) student.deskId = null;
    }
    this.markDirty(); this.renderSeatingCanvas(); this.renderSeatingPool();
  },

  renderSeatingPool() {
    const pool = document.getElementById('unassigned-pool'); if (!pool) return;
    const unassigned = (window.appState.seatingStudents || []).filter(s => !s.deskId);
    const count = document.getElementById('pool-count'); if (count) count.textContent = String(unassigned.length);
    pool.innerHTML = '';
    unassigned.forEach(student => {
      const pill = document.createElement('div'); pill.className = 'student-pool-pill'; pill.draggable = true; pill.textContent = student.name;
      pill.addEventListener('dragstart', event => this.dragEntity(event, student.id, 'student'));
      pool.appendChild(pill);
    });
  },

  renderSeatingCanvas() {
    const canvas = document.getElementById('seating-canvas'); if (!canvas) return;
    canvas.innerHTML = '';
    (window.appState.furniture || []).forEach(item => {
      const el = document.createElement('div'); el.className = `room-furniture furniture-${item.type}`; el.style.left = `${Number(item.x)}px`; el.style.top = `${Number(item.y)}px`; el.draggable = true;
      el.innerHTML = `<i class="fas ${item.type === 'whiteboard' ? 'fa-chalkboard' : 'fa-person-chalkboard'}"></i><span>${item.type === 'whiteboard' ? 'Board' : 'Teacher'}</span>`;
      el.addEventListener('dragstart', event => this.dragEntity(event, item.id, 'furniture')); canvas.appendChild(el);
    });
    (window.appState.desks || []).forEach(desk => {
      const student = (window.appState.seatingStudents || []).find(s => s.deskId === desk.id);
      const el = document.createElement('div'); el.className = student ? 'desk-card' : 'desk-placeholder'; el.style.left = `${Number(desk.x)}px`; el.style.top = `${Number(desk.y)}px`; el.draggable = true; el.dataset.deskId = desk.id;
      if (student) {
        const dots = this.privacyVisible ? `${student.sen ? '<span class="dot dot-sen" title="SEN"></span>' : ''}${student.pp ? '<span class="dot dot-pp" title="Pupil Premium"></span>' : ''}${student.fsm ? '<span class="dot dot-fsm" title="FSM"></span>' : ''}` : '';
        el.id = `card-${student.id}`;
        el.innerHTML = `<div class="desk-name" draggable="true">${window.app.escapeHTML(student.name)}</div><div class="desk-meta">CAT: ${window.app.escapeHTML(student.catMean || '-')}</div><div class="privacy-dots">${dots}</div>`;
        el.querySelector('.desk-name').addEventListener('dragstart', event => this.dragEntity(event, student.id, 'student'));
      } else el.innerHTML = '<span>Empty desk</span>';
      el.addEventListener('dragstart', event => { if (event.target === el) this.dragEntity(event, desk.id, 'desk'); });
      el.addEventListener('dragover', event => this.allowDrop(event));
      el.addEventListener('drop', event => this.dropOnDesk(event, desk.id));
      canvas.appendChild(el);
    });
  },

  togglePrivacy() {
    this.privacyVisible = !this.privacyVisible;
    const btn = document.getElementById('privacy-toggle'); if (btn) btn.classList.toggle('active', this.privacyVisible);
    this.renderSeatingCanvas();
  },

  ensureProjectorOpen() {
    document.body.classList.add('projector-active');
    const overlay = document.getElementById('projector-overlay'); if (overlay) overlay.style.display = 'flex';
  },

  toggleProjectorMode() {
    const active = document.body.classList.toggle('projector-active');
    const overlay = document.getElementById('projector-overlay'); if (overlay) overlay.style.display = active ? 'flex' : 'none';
  },

  pickRandomName() {
    this.ensureProjectorOpen();
    const random = document.getElementById('pt-random'); if (random) random.style.display = 'block';
    this.spinRandomName();
  },

  spinRandomName() {
    let pool = (window.appState.seatingStudents || []).filter(s => s.deskId);
    if (!pool.length) pool = (window.appState.seatingStudents || []).filter(s => !s.deskId);
    if (!pool.length) return window.app.showToast('No students in this class.', 'error');
    const display = document.getElementById('random-name-display'); if (!display) return;
    document.querySelectorAll('.desk-card').forEach(c => c.classList.remove('highlight'));
    let ticks = 0;
    const interval = setInterval(() => {
      display.textContent = pool[Math.floor(Math.random() * pool.length)].name;
      ticks += 1;
      if (ticks >= 16) {
        clearInterval(interval);
        const winner = pool[Math.floor(Math.random() * pool.length)]; display.textContent = winner.name;
        document.getElementById(`card-${winner.id}`)?.classList.add('highlight');
      }
    }, 70);
  },

  async toggleNoiseMeter() {
    if (this.noiseStream) return this.stopNoiseMeter();
    if (!navigator.mediaDevices?.getUserMedia) return window.app.showToast('Microphone access is not supported on this device.', 'error');
    try {
      this.noiseStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await this.audioContext.resume();
      this.mediaSource = this.audioContext.createMediaStreamSource(this.noiseStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.75;
      this.silentGain = this.audioContext.createGain();
      this.silentGain.gain.value = 0.00001;
      // Keep the Web Audio graph actively pulled without audible feedback.
      this.mediaSource.connect(this.analyser);
      this.analyser.connect(this.silentGain);
      this.silentGain.connect(this.audioContext.destination);

      document.getElementById('noise-toggle')?.classList.add('active');
      this.ensureProjectorOpen();
      const panel = document.getElementById('pt-noise'); if (panel) panel.style.display = 'block';
      const frequency = new Uint8Array(this.analyser.frequencyBinCount);
      const waveform = new Uint8Array(this.analyser.fftSize);
      const draw = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(frequency);
        this.analyser.getByteTimeDomainData(waveform);
        const avgFrequency = frequency.reduce((sum, value) => sum + value, 0) / Math.max(1, frequency.length);
        let sumSquares = 0;
        for (const value of waveform) { const normalized = (value - 128) / 128; sumSquares += normalized * normalized; }
        const rms = Math.sqrt(sumSquares / Math.max(1, waveform.length));
        const percent = Math.min(100, Math.round(Math.max((avgFrequency / 90) * 100, rms * 240)));
        document.querySelectorAll('.noise-meter-fill').forEach(el => { el.style.width = `${Math.max(3, percent)}%`; el.style.transform = `scaleY(${0.72 + Math.min(.28, percent / 360)})`; });
        document.querySelectorAll('.noise-meter-value').forEach(el => { el.textContent = `${percent}%`; });
        this.noiseRAF = requestAnimationFrame(draw);
      };
      draw();
      window.app.showToast('Live Noise Meter started.');
    } catch (error) {
      console.error(error);
      await this.stopNoiseMeter();
      window.app.showToast('Microphone permission was not granted or no live audio was available.', 'error');
    }
  },

  async stopNoiseMeter() {
    if (this.noiseRAF) cancelAnimationFrame(this.noiseRAF); this.noiseRAF = null;
    try { this.mediaSource?.disconnect(); } catch (_) {}
    try { this.analyser?.disconnect(); } catch (_) {}
    try { this.silentGain?.disconnect(); } catch (_) {}
    if (this.noiseStream) this.noiseStream.getTracks().forEach(track => track.stop());
    this.noiseStream = null; this.mediaSource = null; this.silentGain = null;
    if (this.audioContext) { try { await this.audioContext.close(); } catch (_) {} }
    this.audioContext = null; this.analyser = null;
    document.getElementById('noise-toggle')?.classList.remove('active');
    const panel = document.getElementById('pt-noise'); if (panel) panel.style.display = 'none';
    document.querySelectorAll('.noise-meter-fill').forEach(el => { el.style.width = '3%'; });
    document.querySelectorAll('.noise-meter-value').forEach(el => { el.textContent = '0%'; });
  }
};
