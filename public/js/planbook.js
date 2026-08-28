// public/js/planbook.js
window.planbookController = {
    dayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    currentWeekType: 'A',
    planbookView: 'week',
    currentActiveDate: new Date(),
    currentMonday: new Date(),
    saveTimeouts: new Map(),
    isRecording: false,

    async init() {
        if (this.currentActiveDate.getDay() === 0 || this.currentActiveDate.getDay() === 6) {
            this.currentActiveDate.setDate(this.currentActiveDate.getDate() + (this.currentActiveDate.getDay() === 0 ? 1 : 2));
        }
        this.currentActiveDate.setHours(0,0,0,0);
        
        this.currentMonday = new Date(this.currentActiveDate);
        this.currentMonday.setDate(this.currentMonday.getDate() - (this.currentMonday.getDay() === 0 ? 6 : this.currentMonday.getDay() - 1));

        await this.updateDateUI(true);
    },

    getSchoolDateString(d) { 
        if(!d || isNaN(d.getTime())) d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; 
    },

    setPlanbookView(view) {
        this.planbookView = view;
        const bDay = document.getElementById('btn-view-day');
        const bWeek = document.getElementById('btn-view-week');
        if(bDay && bWeek) {
            bDay.style.background = view === 'day' ? 'var(--card)' : 'transparent';
            bDay.style.boxShadow = view === 'day' ? 'var(--shadow-sm)' : 'none';
            bDay.style.color = view === 'day' ? 'var(--text-main)' : 'var(--text-muted)';
            
            bWeek.style.background = view === 'week' ? 'var(--card)' : 'transparent';
            bWeek.style.boxShadow = view === 'week' ? 'var(--shadow-sm)' : 'none';
            bWeek.style.color = view === 'week' ? 'var(--text-main)' : 'var(--text-muted)';
        }
        this.updateDateUI(false);
    },

    navigateDate(dir) {
        if (this.planbookView === 'week') {
            this.currentMonday.setDate(this.currentMonday.getDate() + (dir * 7));
            this.currentActiveDate = new Date(this.currentMonday); 
        } else {
            this.currentActiveDate.setDate(this.currentActiveDate.getDate() + dir);
            if (this.currentActiveDate.getDay() === 6) this.currentActiveDate.setDate(this.currentActiveDate.getDate() + (dir > 0 ? 2 : -1));
            if (this.currentActiveDate.getDay() === 0) this.currentActiveDate.setDate(this.currentActiveDate.getDate() + (dir > 0 ? 1 : -2));
            this.currentMonday = new Date(this.currentActiveDate);
            this.currentMonday.setDate(this.currentMonday.getDate() - (this.currentMonday.getDay() === 0 ? 6 : this.currentMonday.getDay() - 1));
        }
        const hdr = document.getElementById('header-date-range');
        if(hdr) hdr.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        this.updateDateUI(false);
    },

    async updateDateUI(isFullRefresh = true) {
        let days = []; 
        
        if (window.dashboardController) {
            this.currentWeekType = window.dashboardController.calculateWeekType(this.currentMonday);
        }
        
        const hdr = document.getElementById('header-date-range');
        if(hdr) {
            if (this.planbookView === 'week') {
                for (let i = 0; i < 5; i++) { let d = new Date(this.currentMonday); d.setDate(d.getDate() + i); days.push(d); }
                hdr.innerText = `${days[0].toLocaleString('default', { month: 'short' })} ${days[0].getDate()} - ${days[4].toLocaleString('default', { month: 'short' })} ${days[4].getDate()} (Week ${this.currentWeekType})`;
            } else {
                days.push(this.currentActiveDate);
                hdr.innerText = `${this.dayNames[this.currentActiveDate.getDay()]}, ${this.currentActiveDate.toLocaleString('default', { month: 'short' })} ${this.currentActiveDate.getDate()} (Week ${this.currentWeekType})`;
            }
        }

        if(isFullRefresh) {
            try {
                const [resP, resT] = await Promise.all([ 
                    fetch('/api/periods').catch(()=>null),
                    fetch('/api/timetable').catch(()=>null)
                ]);
                if(resP && resP.ok) {
                    window.appState.rawPeriods = await resP.json();
                    if (window.settingsController) window.settingsController.sortPeriodsChronologically();
                }
                if(resT && resT.ok) window.appState.blocks = await resT.json();
            } catch(e) {}
        }
        
        this.renderGrid(days); 
        await this.loadData(days); 
    },

    renderGrid(days) {
        const grid = document.getElementById('planner-grid'); 
        if (!grid) return;
        
        grid.className = days.length === 1 ? 'grid day-view' : 'grid';
        let html = '<div class="grid-header"></div>'; 
        
        days.forEach((day) => { 
            html += `<div class="grid-header"><span>${this.dayNames[day.getDay()]}</span><span class="date-num">${day.getDate()}</span></div>`; 
        });
        
        html += `<div class="time-col"><strong>Notes</strong></div>`;
        days.forEach(day => { 
            html += `<div class="note-cell" contenteditable="true" data-type="note" data-date="${this.getSchoolDateString(day)}" oninput="planbookController.triggerAutoSave(this)"></div>`; 
        });
        
        const periods = window.appState.rawPeriods || [];

        periods.forEach(p => {
            html += `<div class="time-col"><strong>${p.label}</strong><span>${p.startTime} - ${p.endTime}</span></div>`;
            
            if(p.isBreak) {
                html += `<div style="grid-column: span ${days.length}; background: var(--border); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--text-muted); letter-spacing: 2px; text-transform: uppercase;">${p.label}</div>`;
            } else {
                days.forEach((day) => {
                    const ds = this.getSchoolDateString(day); 
                    const block = (window.appState.blocks || []).find(b => b.dayOfWeek === day.getDay() && String(b.period) === String(p.id) && b.weekType === this.currentWeekType);
                    
                    let label = '', classId = '', bgStyle = '';
                    if (block) {
                        if (block.entryType === 'CLASS' && block.class) { 
                            label = block.class.name; 
                            classId = block.class.id; 
                            bgStyle = `border-left-color: ${block.class.colorHex || 'var(--accent)'};`; 
                        } else { 
                            label = block.label; 
                            bgStyle = "border-left-color: var(--border);"; 
                        }
                    }
                    html += `<div class="lesson-cell" style="${bgStyle}">
                                <div class="cell-header"><span>${label}</span></div>
                                <div class="content" contenteditable="true" data-type="lesson" data-date="${ds}" data-period="${p.id}" data-classid="${classId}" oninput="planbookController.triggerAutoSave(this)"></div>
                             </div>`;
                });
            }
        });
        grid.innerHTML = html;
    },

    triggerAutoSave(element) {
        const html = element.innerHTML;
        const date = element.getAttribute('data-date');
        const type = element.getAttribute('data-type');
        const period = element.getAttribute('data-period');
        
        const entityKey = type === 'lesson' ? `lesson_${date}_${period}` : `note_${date}`;
        window.idb.set(entityKey, html); 
        
        if(this.saveTimeouts.has(entityKey)) clearTimeout(this.saveTimeouts.get(entityKey));
        
        this.saveTimeouts.set(entityKey, setTimeout(async () => {
            const payload = type === 'lesson' ? { date, period, planText: html, classId: element.getAttribute('data-classid') } : { date, noteText: html };
            try { 
                await fetch(type === 'lesson' ? '/api/lessons' : '/api/notes', { 
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) 
                }); 
                window.app.showToast("Saved!");
            } catch (e) {}
        }, 1000));
    },

    async loadData(days) {
        if (!days || days.length === 0) return;
        const fromDate = this.getSchoolDateString(days[0]);
        const toDate = this.getSchoolDateString(days[days.length-1]);
        
        for (const day of days) {
            const ds = this.getSchoolDateString(day); 
            const localNote = await window.idb.get(`note_${ds}`);
            if(localNote) { 
                const n = document.querySelector(`.note-cell[data-type="note"][data-date="${ds}"]`); 
                if(n) n.innerHTML = localNote; 
            }
            const periods = window.appState.rawPeriods || [];
            for (const p of periods) {
                if (p.isBreak) continue;
                const localLesson = await window.idb.get(`lesson_${ds}_${p.id}`);
                if(localLesson) { 
                    const box = document.querySelector(`.content[data-date="${ds}"][data-period="${p.id}"]`); 
                    if(box) box.innerHTML = localLesson; 
                }
            }
        }
        
        try {
            const [resL, resN] = await Promise.all([
                fetch(`/api/lessons?from=${fromDate}&to=${toDate}`), 
                fetch(`/api/notes?from=${fromDate}&to=${toDate}`)
            ]);
            
            if (resL && resL.ok && resN && resN.ok) {
                const lessons = await resL.json(); 
                const notes = await resN.json();
                
                if(Array.isArray(lessons)) {
                    document.querySelectorAll('.content').forEach(box => {
                        const ds = box.getAttribute('data-date');
                        const p = box.getAttribute('data-period');
                        const saved = lessons.find(l => l.date && l.date.split('T')[0] === ds && String(l.period) === String(p));
                        if (saved) { 
                            box.innerHTML = saved.planText; 
                            window.idb.set(`lesson_${ds}_${p}`, saved.planText); 
                        } 
                    });
                }
                
                if(Array.isArray(notes)) {
                    notes.forEach(n => { 
                        const ds = n.date && n.date.split('T')[0];
                        const b = document.querySelector(`.note-cell[data-type="note"][data-date="${ds}"]`); 
                        if(b) { 
                            b.innerHTML = n.noteText; 
                            window.idb.set(`note_${ds}`, n.noteText); 
                        } 
                    });
                }
            }
        } catch (e) {}
    },

    insertChecklist() {
        const id = 'chk-' + Date.now();
        document.execCommand('insertHTML', false, `<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;"><input type="checkbox" id="${id}" style="cursor:pointer;"><label for="${id}">Task</label></div><br>`);
    },

    insertImage(event) {
        const file = event.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            document.execCommand('insertHTML', false, `<img src="${e.target.result}" style="max-width:100%; border-radius:4px; margin: 8px 0;" />`);
        };
        reader.readAsDataURL(file);
    },

    toggleAudioRecord(btn) {
        this.isRecording = !this.isRecording;
        if(this.isRecording) {
            btn.innerHTML = '<i class="fas fa-stop-circle"></i>';
            btn.style.color = '#ef4444';
            window.app.showToast("Recording Voice Note...");
        } else {
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
            btn.style.color = '#10b981';
            document.execCommand('insertHTML', false, `<div style="background:var(--border); padding:8px 12px; border-radius:20px; display:inline-flex; align-items:center; gap:8px; font-size:0.85em; cursor:pointer;"><i class="fas fa-play-circle" style="color:var(--accent);"></i> Voice Note</div> `);
            window.app.showToast("Voice Note Saved");
        }
    }
};
