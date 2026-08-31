window.aistudioController = {
  toolkitCatalog: [
    ['Pedagogy & Planning', [
      ['sow','🗓️ 6-Week Scheme of Work'],['lesson_plan','📝 Detailed 60-Minute Lesson Plan'],['five_part','🧩 Five-Part Lesson Builder'],['hook','🎣 Lesson Hooks / Starters'],['plenary','🚪 Exit Tickets / Plenaries'],['concept_check','❓ Hinge & Concept-Check Questions'],['rubric','📊 Assessment Rubric Matrix'],['retrieval','🧠 Spaced Retrieval Practice'],['homework','🏠 Purposeful Homework + Answers'],['misconception','⚠️ Misconception Anticipator'],['modelling','👩‍🏫 I Do / We Do / You Do Modelling'],['questioning','💬 Questioning Sequence'],['interleave','🔀 Interleaved Practice'],['revision','📚 Revision Lesson & Pack'],['knowledge_organiser','🗂️ Knowledge Organiser']
    ]],
    ['Differentiation & Access', [
      ['explainer','💡 Age-Appropriate Concept Explainer'],['dyslexia_adapt','🟦 Dyslexia-Friendly Text Adapter'],['eal_vocab','🌍 EAL Vocabulary & Language Support'],['adhd_scaffold','⚡ ADHD Task Scaffolder'],['autism_clear','🔎 Literal / Autism-Friendly Instructions'],['stretch','🚀 Stretch & Challenge Extensions'],['send_adapt','♿ SEND Access Adaptations'],['reading_age','📖 Reading-Age Adapter'],['chunk_task','✅ Chunk a Complex Task'],['scaffold_write','🪜 Writing Scaffold']
    ]],
    ['Literacy & Language', [
      ['comprehension','📘 Differentiated Comprehension'],['spag','✍️ SPaG Correction Generator'],['vocab','🔤 Tier 2 / Tier 3 Vocabulary'],['model_answer','🏆 WAGOLL / Model Answer'],['debate','🗣️ Class Debate Motion'],['writing_frame','🧱 Writing Frame'],['summary','📝 Student-Friendly Summary'],['glossary','📕 Glossary Builder'],['command_words','🎯 Exam Command-Word Trainer']
    ]],
    ['Assessment & Marking', [
      ['quiz','❓ Knowledge Quiz + Answers'],['short_test','🧪 Short Assessment + Mark Scheme'],['markscheme','🧠 Marking AI Pro / Mark-Scheme Analysis'],['exam_questions','📝 Exam-Style Questions'],['feedback_bank','💬 Feedback Statement Bank'],['self_assessment','🪞 Self-Assessment Tool'],['peer_assessment','🤝 Peer-Assessment Tool'],['gap_analysis','🔍 Knowledge-Gap Analysis']
    ]],
    ['Pastoral, Parents & Leadership', [
      ['reports','📄 Report Comment Generator'],['email_praise','🌟 Positive Parent/Carer Email'],['email_angry','🕊️ De-escalation Parent/Carer Email'],['newsletter','📰 Newsletter Copy'],['parent_call','📞 Parent Call Script'],['detention_script','🔄 Restorative Detention Script'],['pastoral_plan','❤️ Pastoral Intervention Plan'],['assembly','🎤 Assembly Script'],['policy','📜 School Policy Draft'],['observation','👀 Lesson Observation Feedback'],['sip','📈 School Improvement Plan Actions'],['governor','🏛️ Governor Briefing'],['cpd','🎓 CPD Session Plan'],['risk','⚠️ Risk Assessment'],['meeting_agenda','📅 Meeting Agenda'],['minutes','🗒️ Meeting Minutes / Actions'],['line_management','🧭 Line-Management Agenda'],['intervention','🎯 Academic Intervention Plan']
    ]],
    ['Creative & Classroom Resources', [
      ['song','🎵 Mnemonic / Learning Song'],['timeline','⏳ Timeline Resource'],['case_study','💼 Case Study Generator'],['scenario','🎭 Scenario / Role Play'],['worksheet','📄 Worksheet + Answers'],['flashcards','🃏 Flashcard Set'],['dual_code','🖼️ Dual-Coding Suggestions'],['compare','⚖️ Comparison Matrix'],['data_response','📈 Data-Response Activity']
    ]],
    ['Phonics & Reading Intervention', [
      ['phonics','🔊 Secondary Phonics Catch-Up'],['phonics_vocab','🔤 Phonics-Informed Subject Vocabulary'],['phonics_diagnostic','🩺 Phonics / Decoding Diagnostic'],['fluency','📖 Reading Fluency Intervention']
    ]]
  ],

  init() {
    const select = document.getElementById('ai-tool-select');
    if (!select) return;
    select.innerHTML = '';
    this.toolkitCatalog.forEach(([groupLabel, options]) => {
      const group = document.createElement('optgroup'); group.label = groupLabel;
      options.forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; group.appendChild(option); });
      select.appendChild(group);
    });
    const count = this.toolkitCatalog.reduce((total, [, options]) => total + options.length, 0);
    const badge = document.getElementById('toolkit-count'); if (badge) badge.textContent = `${count} tools`;
  },

  async jsonOrError(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.error) throw new Error(data?.error?.message || `Request failed (${response.status})`);
    return data;
  },

  async generatePowerPoint() {
    const topic = document.getElementById('ai-slide-topic').value.trim();
    const keyStage = document.getElementById('ai-keystage').value;
    const curriculum = document.getElementById('ai-curriculum').value.trim();
    const customStructure = document.getElementById('ai-slide-structure').value.trim();
    const button = document.getElementById('btn-slide-gen');
    if (!topic) return window.app.showToast('Enter a lesson topic.', 'error');
    if (typeof window.pptxgen !== 'function' && typeof window.PptxGenJS !== 'function') return window.app.showToast('PPTX generator library is not available.', 'error');
    const original = button.innerHTML; button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Building deck…';
    try {
      const response = await fetch('/api/ai/slides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, keyStage, curriculum, customStructure }) });
      const slides = await this.jsonOrError(response);
      if (!Array.isArray(slides)) throw new Error('AI returned an invalid slide structure.');
      const PptxCtor = window.PptxGenJS || window.pptxgen;
      const pptx = new PptxCtor();
      pptx.layout = 'LAYOUT_WIDE';
      slides.forEach(item => {
        const slide = pptx.addSlide();
        slide.addText(String(item.title || 'Lesson'), { x: 0.6, y: 0.45, w: 12.1, h: 0.7, fontSize: 28, bold: true });
        slide.addText(String(item.content || ''), { x: 0.7, y: 1.45, w: 11.9, h: 5.4, fontSize: 18, breakLine: false, valign: 'top', margin: 0.08 });
        if (item.speakerNotes && typeof slide.addNotes === 'function') slide.addNotes(String(item.speakerNotes));
      });
      await pptx.writeFile({ fileName: `${topic.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'FlowDesk'}_Lesson.pptx` });
      window.app.showToast('Presentation generated.');
    } catch (error) { console.error(error); window.app.showToast(error.message || 'AI generation failed.', 'error'); }
    finally { button.disabled = false; button.innerHTML = original; }
  },

  async runToolkit() {
    const tool = document.getElementById('ai-tool-select').value;
    const topic = document.getElementById('ai-tool-topic').value.trim();
    const output = document.getElementById('ai-tool-output');
    const button = document.getElementById('btn-toolkit-gen');
    if (!topic) return window.app.showToast('Enter a topic or context.', 'error');
    const original = button.innerHTML; button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…'; output.innerHTML = '<div class="ai-wait"><i class="fas fa-wand-magic-sparkles"></i> Building resource…</div>';
    try {
      const response = await fetch('/api/ai/toolkit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, topic }) });
      const data = await this.jsonOrError(response); output.innerHTML = data.text || '<p>No content returned.</p>';
    } catch (error) { output.textContent = error.message; }
    finally { button.disabled = false; button.innerHTML = original; }
  },

  async runAutoMarker() {
    const submission = document.getElementById('ai-marking-input').value.trim();
    const criteria = document.getElementById('ai-marking-criteria').value.trim();
    const output = document.getElementById('ai-marking-output');
    const button = document.getElementById('btn-mark-gen');
    if (!submission) return window.app.showToast('Paste the student submission first.', 'error');
    const context = `${criteria ? `Assessment criteria / mark scheme supplied by teacher:\n${criteria}\n\n` : ''}Student submission:\n${submission}`;
    const original = button.innerHTML; button.disabled = true; button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analysing…'; output.innerHTML = '<div class="ai-wait"><i class="fas fa-magnifying-glass-chart"></i> Analysing evidence…</div>';
    try {
      const response = await fetch('/api/ai/toolkit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: 'markscheme', topic: context }) });
      const data = await this.jsonOrError(response); output.innerHTML = data.text || '<p>No feedback returned.</p>';
    } catch (error) { output.textContent = error.message; }
    finally { button.disabled = false; button.innerHTML = original; }
  }
};
