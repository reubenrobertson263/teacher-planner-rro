window.aistudioController = {
    init() {},

    async generatePowerPoint() {
        const topic = document.getElementById('ai-slide-topic').value;
        const keyStage = document.getElementById('ai-keystage').value;
        const curriculum = document.getElementById('ai-curriculum').value;
        const structure = document.getElementById('ai-slide-structure').value;
        const btn = document.getElementById('btn-slide-gen');
        
        if (!topic) return alert("Please enter a lesson topic.");
        
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating PPTX...';
        btn.disabled = true;
        
        try {
            const res = await fetch('/api/ai/slides', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, keyStage, curriculum, customStructure: structure })
            });
            const slidesData = await res.json();
            
            if (slidesData.error) throw new Error(slidesData.error.message);

            let pptx = new pptxgen();
            slidesData.forEach(slide => {
                let s = pptx.addSlide();
                s.addText(slide.title, { x: 0.5, y: 0.5, w: '90%', h: 1, fontSize: 32, bold: true, color: '6366f1' });
                s.addText(slide.content, { x: 0.5, y: 1.5, w: '90%', h: 4, fontSize: 20, bullet: true });
                if(slide.speakerNotes) s.addNotes(slide.speakerNotes);
            });
            pptx.writeFile({ fileName: `${topic.replace(/[^a-z0-9]/gi, '_')}_Lesson.pptx` });
            window.app.showToast("Presentation Downloaded!");
            
        } catch(e) { 
            alert("AI Generation failed. Check API key in settings."); 
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    },

    async runToolkit() {
        const tool = document.getElementById('ai-tool-select').value;
        const topic = document.getElementById('ai-tool-topic').value;
        const output = document.getElementById('ai-tool-output');
        
        if(!topic) return alert("Please enter a topic or context.");
        output.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        
        try {
            const res = await fetch('/api/ai/toolkit', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool, topic }) 
            });
            const data = await res.json();
            output.innerHTML = data.text || "Error generating content.";
        } catch(e) { 
            output.innerHTML = "Error: Ensure your AI API key is saved in Settings."; 
        }
    },

    async runAutoMarker() {
        const text = document.getElementById('ai-marking-input').value;
        const output = document.getElementById('ai-marking-output');
        
        if(!text) return alert("Paste coursework first.");
        output.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing Submission...';
        
        try {
            const res = await fetch('/api/ai/toolkit', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tool: 'markscheme', topic: text }) 
            });
            const data = await res.json();
            output.innerHTML = data.text || "Error generating feedback.";
        } catch(e) { 
            output.innerHTML = "Error: Ensure your AI API key is saved in Settings."; 
        }
    }
};
