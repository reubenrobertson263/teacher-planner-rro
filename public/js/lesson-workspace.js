window.lessonWorkspace = {
  lesson: null,
  index: 0,
  busy: false,
  el(id) { return document.getElementById(`studio-${id}`); },
  value(id) { return this.el(id)?.value || ''; },
  status(message) { if (this.el('status')) this.el('status').textContent = message; },
  async request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, signal: AbortSignal.timeout(165000), headers: { 'Content-Type': 'application/json', ...options.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status}).`);
    return data;
  },
  async init() {
    this.generation = (this.generation || 0) + 1;
    this.importedSlides = null;
    this.userId = window.app.currentUser.id;
    this.lesson = null;
    this.index = 0;
    this.conversation = [];
    this.el('profile').value = LessonModel.profile + (window.app.currentUser.slideStructure ? '\nAdditional saved preferences: ' + window.app.currentUser.slideStructure : '');
    const draft = await window.idb.get('lesson-studio-draft');
    if (!this.el('topic')) return;
    if (draft) {
      try { this.lesson = draft.lesson ? LessonModel.validate(draft.lesson) : null; this.conversation = draft.conversation || []; this.templateId = draft.templateId || ''; this.fillBrief(draft.brief); } catch { this.status('Saved draft could not be opened. Import a downloaded lesson backup.'); }
    }
    this.el('phase').replaceChildren(...LessonModel.phases.map(phase => { const option = document.createElement('option'); option.textContent = phase; return option; }));
    this.el('templates').addEventListener('change', () => { this.templateId = this.value('templates'); this.scheduleDraft(); });
    this.el('workspace').addEventListener('input', event => {
      if (event.target.closest('[data-slide-field]')) this.captureSlide();
      if (['worksheet', 'answers', 'rationale', 'warnings', 'title'].some(id => event.target === this.el(id)) && this.lesson) this.captureLesson();
      this.scheduleDraft();
      this.renderChecks();
    });
    this.render();
    await this.library();
    await this.refreshTemplates();
    this.renderConversation();
  },
  fillBrief(brief = {}) {
    for (const key of ['topic', 'curriculum', 'keyStage', 'updates', 'source', 'profile', 'duration']) if (brief[key] !== undefined) this.el(key).value = brief[key];
  },
  brief() {
    return LessonModel.brief(Object.fromEntries(['topic', 'curriculum', 'keyStage', 'updates', 'source', 'profile', 'duration'].map(key => [key, this.value(key)])));
  },
  rawBrief() { return Object.fromEntries(['topic', 'curriculum', 'keyStage', 'updates', 'source', 'profile', 'duration'].map(key => [key, this.value(key)])); },
  scheduleDraft() { clearTimeout(this.timer); this.timer = setTimeout(() => this.saveDraft(), 500); },
  async saveDraft() {
    if (!this.el('topic') || window.app.currentUser?.id !== this.userId) return;
    this.captureSlide(); this.captureLesson();
    const ok = await window.idb.set('lesson-studio-draft', { lesson: this.lesson, brief: this.rawBrief(), conversation: this.conversation, templateId: this.value('templates') || this.templateId || '' });
    if (!ok) this.status('Browser draft could not be saved. Download a lesson backup before leaving.');
  },
  async destroy() { this.generation = (this.generation || 0) + 1; clearTimeout(this.timer); await this.saveDraft(); this.lesson = null; this.importedSlides = null; },
  captureSlide() {
    const slide = this.lesson?.slides[this.index];
    if (!slide || !this.el('slide-title')) return;
    for (const key of ['title', 'content', 'speakerNotes', 'sourceRef', 'phase']) slide[key] = this.value(key === 'title' ? 'slide-title' : key);
    slide.minutes = Number(this.value('minutes'));
  },
  captureLesson() {
    if (!this.lesson || !this.el('title')) return;
    for (const [key, id] of Object.entries({ title: 'title', rationale: 'rationale', worksheet: 'worksheet', teacherAnswers: 'answers', warnings: 'warnings' })) this.lesson[key] = this.value(id);
  },
  render() {
    if (!this.el('editor')) return;
    this.el('editor').hidden = !this.lesson;
    if (!this.lesson) return;
    this.index = Math.max(0, Math.min(this.index, this.lesson.slides.length - 1));
    for (const [key, id] of Object.entries({ title: 'title', rationale: 'rationale', worksheet: 'worksheet', teacherAnswers: 'answers', warnings: 'warnings' })) this.el(id).value = this.lesson[key];
    const slide = this.lesson.slides[this.index];
    for (const key of ['title', 'content', 'speakerNotes', 'sourceRef', 'phase', 'minutes']) this.el(key === 'title' ? 'slide-title' : key).value = slide[key];
    this.el('slides').replaceChildren(...this.lesson.slides.map((s, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = i === this.index ? 'studio-slide active' : 'studio-slide';
      button.textContent = `${i + 1}. ${s.title}`; button.setAttribute('aria-pressed', String(i === this.index));
      button.onclick = () => { this.captureSlide(); this.captureLesson(); this.index = i; this.render(); };
      return button;
    }));
    this.renderChecks();
  },
  renderChecks() {
    if (!this.lesson || !this.el('checks')) return;
    this.el('checks').textContent = LessonModel.checks(this.lesson, this.value('duration')).join('\n') || 'Five phases and timings are present. Review subject accuracy, inclusion and answers before teaching.';
    this.el('preview-title').textContent = this.lesson.slides[this.index].title;
    this.el('preview-content').textContent = this.lesson.slides[this.index].content;
  },
  renderConversation() {
    const container = this.el('chat-history');
    if (!container) return;
    container.replaceChildren(...(this.conversation || []).map(message => {
      const item = document.createElement('p'); item.className = 'studio-chat-message'; item.dataset.role = message.role; item.textContent = message.content; return item;
    }));
  },
  async run(action) {
    if (this.busy) return;
    this.busy = true;
    const userId = this.userId;
    const generation = this.generation;
    const inputs = [...(this.el('workspace')?.querySelectorAll('button, input, textarea, select') || [])];
    const disabled = inputs.map(input => input.disabled);
    inputs.forEach(input => { input.disabled = true; });
    this.el('workspace')?.setAttribute('aria-busy', 'true');
    try { await action(); } catch (error) { if (window.app.currentUser?.id === userId && this.generation === generation) this.status(error.name === 'TimeoutError' ? 'The request timed out. Your current lesson is kept; try again.' : error.message); }
    finally { this.busy = false; inputs.forEach((input, i) => { input.disabled = disabled[i]; }); this.el('workspace')?.setAttribute('aria-busy', 'false'); }
  },
  importFile(input) { return this.run(async () => {
    const generation = this.generation;
    const file = input.files[0]; if (!file) return;
    if (/\.json$/i.test(file.name)) {
      if (file.size > 25 * 1024 * 1024) throw new Error('Choose a lesson backup smaller than 25 MB.');
      const raw = JSON.parse(await file.text());
      if (generation !== this.generation) return;
      const lesson = LessonModel.validate(raw.lesson || raw);
      const brief = raw.brief ? LessonModel.brief(raw.brief) : null;
      if (this.lesson && !confirm('Replace the open draft with this imported lesson? Save a version or download a backup first.')) return;
      this.lesson = lesson; if (brief) this.fillBrief(brief);
      this.conversation = raw.conversation || [];
      this.index = 0; this.render(); await this.saveDraft(); this.status('Lesson imported. Review it before teaching.'); return;
    }
    if (![...input.files].every(f => /\.(?:pptx|zip)$/i.test(f.name))) throw new Error('Choose one or more .pptx files or .zip archives of PowerPoints.');
    this.status('Reading the presentation…');
    const imported = await LessonImport.files([...input.files]);
    if (generation !== this.generation) return;
    const prior = this.value('source');
    const append = prior && confirm('Add this batch to existing source presentations? Choose Cancel to replace the source.');
    const combined = append ? `${prior}\n\n${imported.source}` : imported.source;
    if (combined.length > LessonImport.MAX_SOURCE) throw new Error('Combined sources exceed 120,000 characters. Replace the current source or select fewer files.');
    this.el('source').value = combined;
    if (!this.value('topic')) this.el('topic').value = imported.decks.map(d => d.name.split('/').pop().replace(/\.pptx$/i, '')).join(', ').slice(0, 200);
    this.importedSlides = null;
    this.status(`${imported.decks.length} presentations imported (${imported.decks.reduce((n,d)=>n+d.slides,0)} slides). ${imported.notice}`);
    await this.saveDraft(); input.value = '';
  }); },
  newLesson() {
    if (this.lesson && !confirm('Replace the open draft? Save a version or download a backup first.')) return;
    this.lesson = { version: 1, title: this.value('topic') || 'New lesson', rationale: '', worksheet: '', teacherAnswers: '', warnings: '', slides: LessonModel.phases.map((phase, i) => ({ phase, title: phase, content: '', speakerNotes: '', sourceRef: '', minutes: [5, 5, 22, 22, 6][i] })) };
    this.conversation = []; this.index = 0; this.render(); this.renderConversation(); this.scheduleDraft();
  },
  sourceDraft() {
    if (!this.value('source')) return this.status('Import your source presentations or paste their teaching content first.');
    this.newLesson();
  },
  generate() { return this.run(async () => {
    const generation = this.generation;
    const brief = this.brief();
    if (this.lesson && !confirm('Generate a replacement draft? Save a version or download a backup first.')) return;
    this.status('Adapting your source into a BCHS lesson. This can take two minutes…');
    const userId = this.userId;
    const data = await this.request('/api/studio/generate', { method: 'POST', body: JSON.stringify(brief) });
    if (window.app.currentUser?.id !== userId || generation !== this.generation || !this.el('topic')) return;
    this.lesson = LessonModel.validate(data.lesson); this.conversation = []; this.index = 0; this.render(); this.renderConversation(); await this.saveDraft();
    this.status('Draft ready. Review the slides, source references, worksheet and teacher answers before export.');
  }); },
  prompt() { return this.run(async () => {
    const prompt = LessonModel.messages(this.brief()).map(m => m.content).join('\n\nLESSON BRIEF\n');
    this.el('prompt').value = prompt; this.el('manual').open = true;
    try { await navigator.clipboard.writeText(prompt); this.status('Prompt copied. Paste it into your AI chat, then paste the returned JSON below.'); } catch { this.status('Prompt ready below. Select and copy it into your AI chat.'); }
  }); },
  acceptResult() { return this.run(async () => {
    const lesson = LessonModel.parse(this.value('result'));
    if (this.lesson && !confirm('Replace the open draft with this result?')) return;
    this.lesson = lesson; this.conversation = []; this.index = 0; this.render(); this.renderConversation(); await this.saveDraft(); this.status('Result imported. Review the lesson checks and teacher answers.');
  }); },
  slideAction(action) {
    if (!this.lesson) return;
    this.captureSlide(); this.captureLesson();
    const slides = this.lesson.slides;
    if (action === 'add' || action === 'duplicate') {
      if (slides.length >= 40) return this.status('Maximum 40 slides per lesson.');
      const slide = action === 'duplicate' ? structuredClone(slides[this.index]) : { title: 'New slide', phase: slides[this.index].phase, minutes: 0, content: '', speakerNotes: '', sourceRef: '' };
      slides.splice(++this.index, 0, slide);
    } else if (action === 'delete') {
      if (slides.length === 1 || !confirm('Remove this slide from the draft?')) return;
      slides.splice(this.index, 1);
    } else {
      const target = this.index + (action === 'up' ? -1 : 1);
      if (target < 0 || target >= slides.length) return;
      [slides[target], slides[this.index]] = [slides[this.index], slides[target]]; this.index = target;
    }
    this.render(); this.scheduleDraft();
  },
  async library() {
    const generation = this.generation;
    try {
      const rows = await this.request('/api/studio/lessons');
      if (generation !== this.generation || !this.el('library')) return;
      this.el('library').replaceChildren(...rows.map(row => {
        const option = document.createElement('option'); option.value = row.id; option.textContent = `${row.title} — ${new Date(row.updatedAt).toLocaleString()}`; return option;
      }));
      this.el('library-note').textContent = rows.length ? `${rows.length} saved versions` : 'No saved lessons yet.';
    } catch { if (this.el('library-note')) this.el('library-note').textContent = 'Cloud library unavailable. Browser drafts and downloaded backups still work.'; }
  },
  async refreshTemplates() {
    const generation = this.generation;
    try {
      const rows = await this.request('/api/studio/templates');
      if (generation !== this.generation || !this.el('templates')) return;
      const options = rows.map(row => { const option = document.createElement('option'); option.value = row.id; option.textContent = `${row.title} · ${(row.bytes / 1048576).toFixed(1)} MB`; return option; });
      this.el('templates').replaceChildren(...options);
      if (this.templateId && options.some(option => option.value === this.templateId)) this.el('templates').value = this.templateId;
      else this.templateId = this.el('templates').value || '';
      this.el('template-note').textContent = rows.length ? `${rows.length} private template${rows.length === 1 ? '' : 's'} saved to your account.` : 'No school template saved yet. Upload a cover and one slide for each lesson phase.';
    } catch { if (this.el('template-note')) this.el('template-note').textContent = 'Your private templates could not be loaded. Check your connection and refresh.'; }
  },
  uploadTemplate() { return this.run(async () => {
    const file = this.el('template-file').files[0];
    if (!file || !/\.pptx$/i.test(file.name)) throw new Error('Choose a cover and five-phase template saved as PowerPoint.');
    if (file.size > 21 * 1024 * 1024) throw new Error('Choose a template smaller than 21 MB.');
    const buffer = await file.arrayBuffer();
    const summary = await LessonTemplate.inspect(buffer);
    const bytes = new Uint8Array(buffer); let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const title = this.value('template-title').trim() || file.name.replace(/\.pptx$/i, '');
    const saved = await this.request('/api/studio/templates', { method: 'POST', body: JSON.stringify({ title, base64: btoa(binary) }) });
    await this.refreshTemplates(); this.el('templates').value = saved.id; this.templateId = saved.id;
    this.el('template-title').value = title; this.el('template-file').value = '';
    this.scheduleDraft(); this.status(`${title} is private to your account. Its BCHS phase backgrounds and layouts are ready for export.`);
  }); },
  async privateTemplate() {
    const id = this.value('templates') || this.templateId;
    if (!id) throw new Error('Upload and select your private school template first.');
    const item = await this.request(`/api/studio/templates/${encodeURIComponent(id)}`);
    return { item, bytes: Uint8Array.from(atob(item.base64), char => char.charCodeAt(0)) };
  },
  saveVersion() { return this.run(async () => {
    this.captureSlide(); this.captureLesson();
    await this.request('/api/studio/lessons', { method: 'POST', body: JSON.stringify({ lesson: LessonModel.validate(this.lesson), brief: this.brief(), conversation: this.conversation, templateId: this.value('templates') || this.templateId || '' }) });
    this.status('A new version is saved to your account. Previous versions are kept.'); await this.library();
  }); },
  openVersion() { return this.run(async () => {
    const generation = this.generation;
    const id = this.value('library'); if (!id) return;
    if (this.lesson && !confirm('Open this saved version in place of your draft?')) return;
    const data = await this.request(`/api/studio/lessons/${encodeURIComponent(id)}`);
    if (generation !== this.generation) return;
    this.lesson = LessonModel.validate(data.lesson); this.conversation = data.conversation || []; this.fillBrief(data.brief); this.templateId = data.templateId || this.templateId; this.index = 0; this.render(); this.renderConversation(); await this.saveDraft(); this.status('Saved lesson opened.');
  }); },
  refine() { return this.run(async () => {
    if (!this.lesson) throw new Error('Create or generate a lesson before asking for a revision.');
    const change = this.value('change').trim(); if (!change) throw new Error('Describe what you would like changed.');
    this.captureSlide(); this.captureLesson();
    const generation = this.generation;
    const prior = this.conversation.slice(-11);
    this.status('Updating the lesson from your request…');
    const data = await this.request('/api/studio/refine', { method: 'POST', body: JSON.stringify({ brief: this.brief(), lesson: LessonModel.validate(this.lesson), history: prior, change }) });
    if (generation !== this.generation || !this.el('topic')) return;
    this.lesson = LessonModel.validate(data.lesson);
    this.conversation = [...prior, { role: 'user', content: change.slice(0, 2000) }, { role: 'assistant', content: data.reply }].slice(-12);
    this.el('change').value = ''; this.index = Math.min(this.index, this.lesson.slides.length - 1);
    this.render(); this.renderConversation(); await this.saveDraft();
    this.status(data.reply || 'Lesson revised. Review the changed slides and timing checks.');
  }); },
  download(data, name, type) {
    const url = URL.createObjectURL(new Blob([data], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  backup() { return this.run(async () => {
    this.captureSlide(); this.captureLesson();
    this.download(JSON.stringify({ lesson: LessonModel.validate(this.lesson), brief: this.brief(), conversation: this.conversation, templateId: this.templateId || '' }, null, 2), 'FlowDesk-lesson.json', 'application/json');
  }); },
  exportWithTemplate() { return this.run(async () => {
    this.captureSlide(); this.captureLesson();
    const lesson = LessonModel.validate(this.lesson); const { item, bytes } = await this.privateTemplate();
    this.status('Applying your private school layouts and backgrounds…');
    const blob = await LessonTemplate.exportPptx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), lesson);
    const filename = `${lesson.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 80) || 'Lesson'}.pptx`;
    this.download(blob, filename, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    this.status(`${filename} exported with ${item.title}. Teacher notes and answers remain in your private teacher copy; check the PowerPoint before teaching.`);
  }); },
  exportPptx() { return this.run(async () => {
    this.captureSlide(); this.captureLesson();
    const lesson = LessonModel.validate(this.lesson);
    const Pptx = window.PptxGenJS || window.pptxgen;
    if (!Pptx) throw new Error('PowerPoint export is unavailable. Refresh and try again.');
    const pptx = new Pptx(); pptx.layout = 'LAYOUT_WIDE'; pptx.title = lesson.title; pptx.author = 'FlowDesk';
    const background = await window.idb.get('flowdesk-slide-bg');
    lesson.slides.forEach((item, i) => {
      // Long bodies are paginated, not silently truncated or shrunk to unreadable text.
      const chunks = window.LessonExport.pages(item.content);
      chunks.forEach((content, page) => {
        const slide = pptx.addSlide();
        if (background) slide.background = { data: background }; else slide.background = { color: 'FFFFFF' };
        slide.addText(`${item.phase}  •  ${item.minutes} min${page ? ' (continued)' : ''}`, { x: .55, y: .35, w: 12.2, h: .3, fontSize: 14, color: '616575' });
        slide.addText(item.title, { x: .55, y: .85, w: 12.2, h: 1.05, fontSize: 30, bold: true, color: '612C7D', breakLine: false, fit: 'shrink' });
        slide.addText(content || ' ', { x: .6, y: 2.05, w: 12.1, h: 4.55, fontSize: 23, color: '172033', valign: 'top', margin: 0, breakLine: false });
        slide.addText(`${lesson.title}  |  ${i + 1}${page ? '.' + (page + 1) : ''}`, { x: .6, y: 7.05, w: 12, h: .2, fontSize: 10, color: '616575' });
        slide.addNotes(`${item.speakerNotes}\n\nSource: ${item.sourceRef || 'Teacher review required'}\n${page ? 'Continuation: timing belongs to the original slide.' : ''}`);
      });
    });
    await pptx.writeFile({ fileName: `${lesson.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 80) || 'Lesson'}.pptx` });
    this.status('PowerPoint exported. Teacher notes stay in speaker notes; print teacher answers separately.');
  }); },
  print(teacher = false) {
    this.captureSlide(); this.captureLesson(); if (!this.lesson) return;
    const win = window.open('', '_blank'); if (!win) return this.status('Allow pop-ups to print or save as PDF.');
    win.document.title = this.lesson.title;
    const style = win.document.createElement('style'); style.textContent = 'body{font:12pt Arial;margin:2cm;line-height:1.5}pre{white-space:pre-wrap;font:inherit}h1{font-size:22pt}'; win.document.head.append(style);
    const title = win.document.createElement('h1'); title.textContent = this.lesson.title + (teacher ? ' — Teacher copy' : ' — Worksheet');
    const body = win.document.createElement('pre'); body.textContent = teacher ? `${this.lesson.rationale}\n\nANSWERS\n${this.lesson.teacherAnswers}\n\n${this.lesson.slides.map((s, i) => `${i + 1}. ${s.title}\n${s.speakerNotes}`).join('\n\n')}\n\nREVIEW NOTES\n${this.lesson.warnings}` : this.lesson.worksheet;
    win.document.body.append(title, body); win.focus(); win.print();
  }
};

window.LessonExport = {
  pages(text) {
    // Approximate line wrapping at a conservative 75 characters for a 23pt body.
    const lines = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (line.length + word.length + 1 > 75 && line) { lines.push(line); line = ''; }
        for (let offset = 0; offset < word.length; offset += 75) {
          const part = word.slice(offset, offset + 75);
          if (offset) { lines.push(line); line = part; } else line += (line ? ' ' : '') + part;
        }
      }
      lines.push(line);
    }
    const pages = []; for (let i = 0; i < lines.length; i += 10) pages.push(lines.slice(i, i + 10).join('\n'));
    return pages.length ? pages : [''];
  }
};
