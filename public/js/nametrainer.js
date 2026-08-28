// public/js/nametrainer.js
window.nametrainerController = {
    students: [],
    score: 0,
    total: 0,
    currentStudent: null,

    async init() {
        const res = await fetch('/api/classes');
        if (res.ok) window.appState.classes = await res.json();
        
        const sel = document.getElementById('trainer-class-select');
        if (sel) {
            sel.innerHTML = (window.appState.classes || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
        this.startTraining();
    },

    startTraining() {
        const sel = document.getElementById('trainer-class-select');
        if (!sel || !sel.value) return;
        
        const cls = (window.appState.classes || []).find(c => c.id === sel.value);
        this.students = cls && cls.students ? cls.students : [];
        
        if (this.students.length < 2) {
            document.getElementById('trainer-options-grid').innerHTML = '<p style="grid-column: span 2; color: var(--text-muted);">Please upload an Arbor roster with at least 2 students.</p>';
            return;
        }

        this.currentStudent = this.students[Math.floor(Math.random() * this.students.length)];
        
        // Pick 3 random wrong options
        let options = [this.currentStudent];
        while (options.length < Math.min(4, this.students.length)) {
            const rand = this.students[Math.floor(Math.random() * this.students.length)];
            if (!options.find(o => o.id === rand.id)) options.push(rand);
        }
        options.sort(() => Math.random() - 0.5);

        const grid = document.getElementById('trainer-options-grid');
        if (grid) {
            grid.innerHTML = options.map(opt => `
                <button class="btn-outline" style="padding: 14px 10px; font-weight: 700; justify-content: center;" onclick="nametrainerController.checkAnswer('${opt.id}', this)">
                    ${opt.name}
                </button>
            `).join('');
        }
    },

    checkAnswer(selectedId, btn) {
        this.total++;
        if (selectedId === this.currentStudent.id) {
            this.score++;
            btn.style.background = '#10b981';
            btn.style.color = '#fff';
            window.app.showToast("Correct! 🎉");
            setTimeout(() => this.startTraining(), 600);
        } else {
            btn.style.background = '#ef4444';
            btn.style.color = '#fff';
            window.app.showToast(`Incorrect - That's ${this.currentStudent.name}`);
            setTimeout(() => this.startTraining(), 1200);
        }
        document.getElementById('trainer-streak').innerText = `Score: ${this.score} / ${this.total}`;
    }
};
