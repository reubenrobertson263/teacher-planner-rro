window.nametrainerController = {
  ntActiveRoster: [], ntCurrentStudent: null, isNTSoundMuted: false, advanceTimer: null,

  async init() { await this.populateNTFilterValues(); },
  async destroy() { if (this.advanceTimer) clearTimeout(this.advanceTimer); },

  classTokens(student) {
    return String(student.classes || '').split(/[,;|]/).map(v => v.trim()).filter(Boolean);
  },

  async populateNTFilterValues() {
    const type = document.getElementById('nt-filter-type')?.value;
    const input = document.getElementById('nt-filter-value');
    const dataList = document.getElementById('nt-filter-options');
    if (!type || !input || !dataList) return;
    // wholeSchoolRoster is user-namespaced by app.idb, so another login/session cannot bleed into this trainer.
    const roster = await window.idb.get('wholeSchoolRoster') || [];
    const count = document.getElementById('nt-roster-count'); if (count) count.textContent = `${roster.length} students in current roster`;
    if (type === 'all') { input.style.display = 'none'; input.value = ''; return; }
    input.style.display = 'block'; input.value = '';
    const values = new Set();
    roster.forEach(student => {
      if (type === 'year' && (student.year || student.yearGroup)) values.add(String(student.year || student.yearGroup));
      if (type === 'class') this.classTokens(student).forEach(value => values.add(value));
    });
    dataList.innerHTML = [...values].sort((a,b) => a.localeCompare(b, 'en-GB', { numeric: true })).map(v => `<option value="${window.app.escapeHTML(v)}"></option>`).join('');
  },

  async startNTQuiz() {
    const roster = await window.idb.get('wholeSchoolRoster') || [];
    if (!roster.length) return window.app.showToast('Upload the current Arbor Master File in Settings first.', 'error');
    const type = document.getElementById('nt-filter-type').value;
    const wanted = document.getElementById('nt-filter-value').value.trim();
    if (type !== 'all' && !wanted) return window.app.showToast('Choose a year group or class.', 'error');
    this.ntActiveRoster = roster.filter(student => {
      if (type === 'all') return true;
      if (type === 'year') return String(student.year || student.yearGroup || '').toLowerCase() === wanted.toLowerCase();
      if (type === 'class') return this.classTokens(student).some(code => code.toLowerCase() === wanted.toLowerCase());
      return false;
    });
    if (this.ntActiveRoster.length < 4) return window.app.showToast(`Only ${this.ntActiveRoster.length} students match. At least 4 are needed.`, 'error');
    document.getElementById('nt-empty-state').style.display = 'none';
    const quiz = document.getElementById('nt-quiz-area'); quiz.style.display = 'flex'; quiz.style.opacity = '1'; quiz.style.pointerEvents = 'auto';
    await this.loadNextNTCard();
  },

  formatNTName(fullName, mode) {
    const raw = String(fullName || '').trim();
    let first = raw, last = '';
    if (raw.includes(',')) { const [surname, ...rest] = raw.split(','); last = surname.trim(); first = rest.join(',').trim(); }
    else { const parts = raw.split(/\s+/); first = parts[0] || ''; last = parts.length > 1 ? parts.at(-1) : ''; }
    if (mode === 'first') return first;
    if (mode === 'last') return last || first;
    if (mode === 'full' || mode === 'type') return [first, last].filter(Boolean).join(' ');
    return raw;
  },

  genderKey(student) { return String(student.gender || student.sex || '').trim().toLowerCase(); },

  async loadNextNTCard() {
    if (!this.ntActiveRoster.length) return;
    const progress = await window.idb.get('nt_progress') || {};
    const now = Date.now();
    const shuffled = [...this.ntActiveRoster].sort(() => Math.random() - .5);
    const due = shuffled.filter(s => !progress[s.id] || Number(progress[s.id].due || 0) <= now);
    this.ntCurrentStudent = due[0] || shuffled[0];

    const photoBox = document.getElementById('nt-photo-box');
    photoBox.innerHTML = '';
    if (this.ntCurrentStudent.photo && String(this.ntCurrentStudent.photo) !== 'null') {
      const img = document.createElement('img'); img.src = this.ntCurrentStudent.photo; img.alt = 'Student profile photograph'; img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px'; photoBox.appendChild(img);
    } else photoBox.innerHTML = '<i class="fas fa-user-graduate" style="font-size:6em;color:var(--border)"></i>';

    const stat = progress[this.ntCurrentStudent.id] || { box: 1, right: 0, wrong: 0 };
    document.getElementById('nt-stat-level').textContent = stat.box;
    document.getElementById('nt-stat-right').textContent = stat.right;
    document.getElementById('nt-stat-wrong').textContent = stat.wrong;
    const mode = document.getElementById('nt-difficulty').value;
    if (mode === 'type') {
      document.getElementById('nt-options-grid').style.display = 'none'; document.getElementById('nt-type-container').style.display = 'block';
      const input = document.getElementById('nt-type-input'); input.value = ''; input.style.borderColor = 'var(--border)'; document.getElementById('nt-type-feedback').innerHTML = ''; input.focus(); return;
    }
    document.getElementById('nt-options-grid').style.display = 'grid'; document.getElementById('nt-type-container').style.display = 'none';
    let distractors = this.ntActiveRoster.filter(s => s.id !== this.ntCurrentStudent.id);
    const gender = this.genderKey(this.ntCurrentStudent);
    if (gender) { const same = distractors.filter(s => this.genderKey(s) === gender); if (same.length >= 3) distractors = same; }
    distractors.sort(() => Math.random() - .5);
    const options = [this.ntCurrentStudent, ...distractors.slice(0, 3)].sort(() => Math.random() - .5);
    const grid = document.getElementById('nt-options-grid'); grid.innerHTML = '';
    options.forEach(student => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-outline'; button.style.cssText = 'padding:16px;font-size:1.1em;justify-content:center'; button.textContent = this.formatNTName(student.name, mode);
      button.addEventListener('click', () => this.handleNTAnswer(student.id, button)); grid.appendChild(button);
    });
  },

  handleNTTypeAnswer() {
    const input = document.getElementById('nt-type-input'); if (!input.value.trim()) return;
    const normalize = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    const correct = normalize(input.value) === normalize(this.formatNTName(this.ntCurrentStudent.name, 'full'));
    const feedback = document.getElementById('nt-type-feedback');
    if (correct) { feedback.innerHTML = '<span style="color:#10b981"><i class="fas fa-check"></i> Correct!</span>'; input.style.borderColor = '#10b981'; }
    else { feedback.innerHTML = `<span style="color:#ef4444"><i class="fas fa-times"></i> It was ${window.app.escapeHTML(this.formatNTName(this.ntCurrentStudent.name, 'full'))}</span>`; input.style.borderColor = '#ef4444'; }
    this.processNTResult(correct);
  },

  async handleNTAnswer(selectedId, button) {
    const buttons = document.querySelectorAll('#nt-options-grid button'); buttons.forEach(b => { b.style.pointerEvents = 'none'; });
    const correct = selectedId === this.ntCurrentStudent.id;
    button.style.background = correct ? '#10b981' : '#ef4444'; button.style.color = '#fff'; button.style.borderColor = correct ? '#10b981' : '#ef4444';
    if (!correct) {
      const target = this.formatNTName(this.ntCurrentStudent.name, document.getElementById('nt-difficulty').value);
      buttons.forEach(b => { if (b.textContent === target) { b.style.borderColor = '#10b981'; b.style.borderWidth = '3px'; } });
    }
    await this.processNTResult(correct);
  },

  async processNTResult(correct) {
    const typeButton = document.querySelector('#nt-type-container button'); if (typeButton) typeButton.disabled = true;
    const progress = await window.idb.get('nt_progress') || {};
    const stat = progress[this.ntCurrentStudent.id] || { box: 1, right: 0, wrong: 0, due: Date.now() };
    if (correct) { this.playNTChime(true); stat.right += 1; stat.box = Math.min(5, stat.box + 1); }
    else { this.playNTChime(false); stat.wrong += 1; stat.box = 1; }
    const intervals = [0, 1, 3, 7, 14, 30]; stat.due = Date.now() + intervals[stat.box] * 86400000; progress[this.ntCurrentStudent.id] = stat;
    await window.idb.set('nt_progress', progress);
    document.getElementById('nt-stat-level').textContent = stat.box; document.getElementById('nt-stat-right').textContent = stat.right; document.getElementById('nt-stat-wrong').textContent = stat.wrong;
    this.advanceTimer = setTimeout(async () => { if (typeButton) typeButton.disabled = false; await this.loadNextNTCard(); }, 650);
  },

  toggleNTSound() {
    this.isNTSoundMuted = !this.isNTSoundMuted; const button = document.getElementById('nt-sound-btn');
    button.innerHTML = this.isNTSoundMuted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
    button.style.color = this.isNTSoundMuted ? '#ef4444' : ''; button.style.borderColor = this.isNTSoundMuted ? '#ef4444' : 'var(--border)';
  },

  playNTChime(positive) {
    if (this.isNTSoundMuted) return;
    try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = positive ? 880 : 440; gain.gain.setValueAtTime(.08, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.00001, ctx.currentTime + .35); osc.start(); osc.stop(ctx.currentTime + .35); osc.onended = () => ctx.close(); } catch (_) {}
  }
};
