window.nametrainerController = {
    ntActiveRoster: [],
    ntCurrentStudent: null,
    isNTSoundMuted: false,

    async init() {
        await this.populateNTFilterValues();
    },

    async populateNTFilterValues() {
        const type = document.getElementById('nt-filter-type')?.value;
        const valInput = document.getElementById('nt-filter-value');
        const dataList = document.getElementById('nt-filter-options');
        
        if(!type || !valInput || !dataList) return;

        const wholeSchool = await window.idb.get('wholeSchoolRoster') || [];
        const countLabel = document.getElementById('nt-roster-count');
        if (countLabel) countLabel.innerText = `${wholeSchool.length} students in memory`;

        if (type === 'all') { valInput.style.display = 'none'; return; }
        valInput.style.display = 'block'; valInput.value = ''; 
        
        let options = new Set();
        wholeSchool.forEach(s => {
            if (type === 'year' && s.year) options.add(s.year);
            if (type === 'class' && s.classes) { s.classes.split(',').forEach(c => options.add(c.trim())); }
        });

        dataList.innerHTML = '';
        Array.from(options).sort().forEach(o => { if(o) dataList.innerHTML += `<option value="${o}"></option>`; });
    },

    async startNTQuiz() {
        const wholeSchool = await window.idb.get('wholeSchoolRoster') || [];
        if(wholeSchool.length === 0) return alert("No students found. Please upload your Master Arbor Sheet in Settings.");
        
        const type = document.getElementById('nt-filter-type').value;
        const filterVal = document.getElementById('nt-filter-value').value;
        if (type !== 'all' && !filterVal) return alert("Please type or select a target group from the list.");

        this.ntActiveRoster = wholeSchool.filter(s => {
            if(type === 'all') return true;
            if(type === 'year') return s.year === filterVal;
            if(type === 'class') return s.classes && s.classes.includes(filterVal);
            return false;
        });

        if(this.ntActiveRoster.length < 4) return alert(`Found only ${this.ntActiveRoster.length} students. You need at least 4 to run flashcards.`);

        document.getElementById('nt-empty-state').style.display = 'none';
        const quizArea = document.getElementById('nt-quiz-area');
        quizArea.style.display = 'flex';
        quizArea.style.opacity = '1';
        quizArea.style.pointerEvents = 'auto';

        this.loadNextNTCard();
    },

    formatNTName(fullName, mode) {
        let first = fullName, last = '';
        if (fullName.includes(',')) {
            let parts = fullName.split(','); last = parts[0].trim(); first = parts[1].trim();
        } else {
            let parts = fullName.split(' '); first = parts[0].trim(); last = parts[parts.length - 1].trim();
        }
        if (mode === 'first') return first;
        if (mode === 'last') return last;
        if (mode === 'full' || mode === 'type') return `${first} ${last}`.trim(); 
        return fullName;
    },

    async loadNextNTCard() {
        if(!this.ntActiveRoster || this.ntActiveRoster.length === 0) return;
        let progress = await window.idb.get('nt_progress') || {};
        const now = Date.now();
        let pool = [...this.ntActiveRoster].sort(() => 0.5 - Math.random()); 
        let dueStudents = pool.filter(s => { const stat = progress[s.id]; return !stat || stat.due <= now; });

        this.ntCurrentStudent = dueStudents.length > 0 ? dueStudents[0] : pool[0];

        const photoBox = document.getElementById('nt-photo-box');
        if (this.ntCurrentStudent.photo && this.ntCurrentStudent.photo !== 'null') {
            photoBox.innerHTML = `<img src="${this.ntCurrentStudent.photo}" style="width:100%; height:100%; object-fit:cover; border-radius: 8px;">`;
        } else {
            photoBox.innerHTML = `<i class="fas fa-user-graduate" style="font-size: 6em; color: var(--border);"></i>`;
        }

        const stat = progress[this.ntCurrentStudent.id] || { box: 1, right: 0, wrong: 0 };
        document.getElementById('nt-stat-level').innerText = stat.box;
        document.getElementById('nt-stat-right').innerText = stat.right;
        document.getElementById('nt-stat-wrong').innerText = stat.wrong;

        const diffMode = document.getElementById('nt-difficulty').value;

        if (diffMode === 'type') {
            document.getElementById('nt-options-grid').style.display = 'none';
            document.getElementById('nt-type-container').style.display = 'block';
            document.getElementById('nt-type-input').value = '';
            document.getElementById('nt-type-input').style.borderColor = 'var(--border)';
            document.getElementById('nt-type-feedback').innerHTML = '';
            document.getElementById('nt-type-input').focus();
        } else {
            document.getElementById('nt-options-grid').style.display = 'grid';
            document.getElementById('nt-type-container').style.display = 'none';

            let distractors = this.ntActiveRoster.filter(s => s.id !== this.ntCurrentStudent.id);
            if (this.ntCurrentStudent.sex) {
                const sameSex = distractors.filter(s => s.sex === this.ntCurrentStudent.sex);
                if (sameSex.length >= 3) distractors = sameSex;
            }
            distractors.sort(() => 0.5 - Math.random());
            let options = [this.ntCurrentStudent, distractors[0], distractors[1], distractors[2]];
            options.sort(() => 0.5 - Math.random());

            let html = '';
            options.forEach(o => {
                const displayName = this.formatNTName(o.name, diffMode);
                html += `<button type="button" class="btn-outline" style="padding:16px; font-size:1.1em; justify-content:center;" onclick="nametrainerController.handleNTAnswer('${o.id}', this)">${displayName}</button>`;
            });
            document.getElementById('nt-options-grid').innerHTML = html;
        }
    },

    handleNTTypeAnswer() {
        const input = document.getElementById('nt-type-input');
        const feedback = document.getElementById('nt-type-feedback');
        if(!input.value) return;

        const guess = input.value.toLowerCase().replace(/,/g, '').replace(/\s+/g, '').trim();
        const targetNormal = this.formatNTName(this.ntCurrentStudent.name, 'full').toLowerCase().replace(/\s+/g, '').trim();
        const isCorrect = (guess === targetNormal);
        
        if (isCorrect) {
            feedback.innerHTML = '<span style="color:#10b981;"><i class="fas fa-check"></i> Correct!</span>';
            input.style.borderColor = '#10b981';
        } else {
            feedback.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-times"></i> It was ${this.formatNTName(this.ntCurrentStudent.name, 'full')}</span>`;
            input.style.borderColor = '#ef4444';
        }
        this.processNTResult(isCorrect);
    },

    async handleNTAnswer(selectedId, btn) {
        const buttons = document.getElementById('nt-options-grid').querySelectorAll('button');
        buttons.forEach(b => b.style.pointerEvents = 'none');

        const isCorrect = (selectedId === this.ntCurrentStudent.id);
        if (isCorrect) {
            btn.style.background = '#10b981'; btn.style.color = '#fff'; btn.style.borderColor = '#10b981';
        } else {
            btn.style.background = '#ef4444'; btn.style.color = '#fff'; btn.style.borderColor = '#ef4444';
            const diffMode = document.getElementById('nt-difficulty').value;
            const targetName = this.formatNTName(this.ntCurrentStudent.name, diffMode);
            buttons.forEach(b => {
                if(b.innerText === targetName) { b.style.borderColor = '#10b981'; b.style.borderWidth = '3px'; }
            });
        }
        this.processNTResult(isCorrect);
    },

    async processNTResult(isCorrect) {
        const typeBtn = document.querySelector('#nt-type-container button');
        if(typeBtn) typeBtn.style.pointerEvents = 'none';

        let progress = await window.idb.get('nt_progress') || {};
        let stat = progress[this.ntCurrentStudent.id] || { box: 1, right: 0, wrong: 0, due: Date.now() };

        if (isCorrect) { this.playNTChime(true); stat.right++; stat.box = Math.min(5, stat.box + 1); } 
        else { this.playNTChime(false); stat.wrong++; stat.box = 1; }

        document.getElementById('nt-stat-right').innerText = stat.right;
        document.getElementById('nt-stat-wrong').innerText = stat.wrong;
        document.getElementById('nt-stat-level').innerText = stat.box;

        const intervals = [0, 1, 3, 7, 14, 30]; 
        stat.due = Date.now() + (intervals[stat.box] * 86400000);
        progress[this.ntCurrentStudent.id] = stat;
        await window.idb.set('nt_progress', progress);

        setTimeout(() => {
            if(typeBtn) typeBtn.style.pointerEvents = 'auto';
            this.loadNextNTCard();
        }, 600);
    },

    toggleNTSound() {
        this.isNTSoundMuted = !this.isNTSoundMuted;
        const btn = document.getElementById('nt-sound-btn');
        if (this.isNTSoundMuted) {
            btn.innerHTML = '<i class="fas fa-volume-mute"></i>';
            btn.style.color = '#ef4444';
            btn.style.borderColor = '#ef4444';
        } else {
            btn.innerHTML = '<i class="fas fa-volume-up"></i>';
            btn.style.color = 'inherit';
            btn.style.borderColor = 'var(--border)';
        }
    },

    playNTChime(isPositive) {
        if (this.isNTSoundMuted) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator(); const gainNode = ctx.createGain();
            osc.connect(gainNode); gainNode.connect(ctx.destination);
            osc.type = 'sine'; osc.frequency.setValueAtTime(isPositive ? 880 : 440, ctx.currentTime);
            if(isPositive) { osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1); }
            gainNode.gain.setValueAtTime(0.1, ctx.currentTime); gainNode.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
        } catch(e) {} 
    }
};
