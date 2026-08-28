// public/js/aistudio.js
window.aistudioController = {
    currentTool: 'slides',

    init() {},

    selectTool(tool) {
        this.currentTool = tool;
        const titleEl = document.getElementById('ai-tool-title');
        const titles = {
            slides: 'Lesson Slide Deck Generator',
            quiz: '10-Question Multiple Choice Quiz',
            sow: '6-Week Scheme of Work Generator',
            spag: 'SPaG Error Passage with Answers',
            song: 'Educational Summary Song',
            reports: 'Differentiated Report Comments',
            email_angry: 'De-escalating Parent Response'
        };
        if (titleEl) titleEl.innerText = titles[tool] || 'AI Generator';
    },

    async generate() {
        const prompt = document.getElementById('ai-topic-prompt').value.trim();
        if (!prompt) return alert("Please enter a topic or instruction.");

        const btn = document.getElementById('btn-generate-ai');
        const out = document.getElementById('ai-output-container');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        btn.disabled = true;

        try {
            if (this.currentTool === 'slides') {
                const res = await fetch('/api/ai/slides', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: prompt, keyStage: 'KS3', curriculum: 'UK National Curriculum' })
                });
                const slides = await res.json();
                out.innerHTML = slides.map((s, i) => `
                    <div style="background:var(--note-bg); border-left:4px solid var(--accent); padding:16px; margin-bottom:12px; border-radius:var(--radius-sm);">
                        <h4 style="margin:0 0 8px 0;">Slide ${i+1}: ${s.title}</h4>
                        <p style="white-space: pre-wrap; font-size:0.95em;">${s.content}</p>
                    </div>
                `).join('');
            } else {
                const res = await fetch('/api/ai/toolkit', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: this.currentTool, topic: prompt })
                });
                const data = await res.json();
                out.innerHTML = `<div style="line-height:1.6; font-size:0.95em;">${data.text}</div>`;
            }
            window.app.showToast("Resource Created!");
        } catch(e) {
            out.innerHTML = `<div style="color:#ef4444;">AI Generation Failed. Please make sure your API Key is added in Settings.</div>`;
        }
        btn.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i> Generate Resource';
        btn.disabled = false;
    }
};
