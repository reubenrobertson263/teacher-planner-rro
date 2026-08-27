// public/js/settings.js
window.settingsController = {
    tourStepIndex: 0,
    tourSteps: [
        { id: 'card-arbor', title: 'Step 1: Upload Arbor Data', text: 'Upload your master Excel file here. This extracts all student names and profile pictures so you can build seating plans.' },
        { id: 'card-periods', title: 'Step 2: Define School Day', text: 'Set your exact timetable periods. Tip: FlowDesk auto-sorts them chronologically based on the time you enter, so they always stay in perfect order!' },
        { id: 'card-calendar', title: 'Step 3: Set Calendar', text: 'Define your term start date and holidays so your Planner maps exactly to your school year.' }
    ],
    
    async init() {
        await this.loadPeriodsFromBackend();
        this.renderPeriodSettings();
        this.populateExistingSettings();
    },

    async loadPeriodsFromBackend() {
        try {
            const res = await fetch('/api/periods');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    window.appState.rawPeriods = data;
                }
            }
        } catch(e) {}
    },

    populateExistingSettings() {
        const savedTheme = localStorage.getItem('flowdesk-theme') || 'light';
        const savedStyle = localStorage.getItem('flowdesk-font-style') || 'standard';
        const savedSize = localStorage.getItem('flowdesk-font-size') || 'standard';
        
        const themeSel = document.getElementById('setting-theme');
        if(themeSel) themeSel.value = savedTheme;
        
        const styleSel = document.getElementById('setting-font-style');
        if(styleSel) styleSel.value = savedStyle;
        
        const sizeSel = document.getElementById('setting-font-size');
        if(sizeSel) sizeSel.value = savedSize;

        const settingsRoomList = document.getElementById('settings-room-list'); 
        if(settingsRoomList && window.appState.rooms) {
            settingsRoomList.innerHTML = '';
            window.appState.rooms.forEach(r => {
                settingsRoomList.innerHTML += `<li style="padding: 6px 0; border-bottom: 1px solid var(--border);">${r.name}</li>`;
            });
        }
    },

    // --- SPOTLIGHT TOUR LOGIC ---
    startTour() {
        let overlay = document.getElementById('tour-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'tour-overlay';
            overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(17, 24, 39, 0.85); z-index: 99998; backdrop-filter: blur(4px); display: none; transition: opacity 0.3s ease;';
            document.body.appendChild(overlay);
        }
        
        let tooltip = document.getElementById('tour-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'tour-tooltip';
            tooltip.style.cssText = 'position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%) translateY(20px); background: var(--accent); color: white; padding: 20px; border-radius: 12px; z-index: 100000; width: 90%; max-width: 420px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); display: none; flex-direction: column; gap: 10px; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease;';
            document.body.appendChild(tooltip);
        }

        this.tourStepIndex = 0;
        overlay.style.display = 'block';
        setTimeout(() => overlay.style.opacity = '1', 10);
        document.body.style.overflow = 'hidden';
        this.renderTourStep();
    },

    renderTourStep() {
        this.tourSteps.forEach(step => {
            const el = document.getElementById(step.id);
            if (el) {
                el.style.zIndex = '1';
                el.style.boxShadow = 'var(--shadow-md)';
                el.style.pointerEvents = 'none';
            }
        });

        if (this.tourStepIndex >= this.tourSteps.length) {
            this.endTour();
            return;
        }

        const step = this.tourSteps[this.tourStepIndex];
        const targetCard = document.getElementById(step.id);
        const tooltip = document.getElementById('tour-tooltip');
        const scrollContainer = document.getElementById('settings-scroll-container');

        if (targetCard && scrollContainer) {
            targetCard.style.zIndex = '99999';
            targetCard.style.boxShadow = '0 0 0 4px var(--accent), 0 20px 25px -5px rgba(0,0,0,0.3)';
            targetCard.style.pointerEvents = 'auto'; 

            const containerRect = scrollContainer.getBoundingClientRect();
            const cardRect = targetCard.getBoundingClientRect();
            
            scrollContainer.scrollTo({
                top: scrollContainer.scrollTop + (cardRect.top - containerRect.top) - 40,
                behavior: 'smooth'
            });

            const isLastStep = this.tourStepIndex === this.tourSteps.length - 1;

            tooltip.innerHTML = `
                <h3 style="margin:0; font-size:1.1em; font-weight:800;">${step.title}</h3>
                <p style="margin:0; font-size:0.95em; line-height:1.5;">${step.text}</p>
                <div style="display:flex; justify-content:space-between; margin-top:10px; align-items:center;">
                    <span style="font-size:0.8em; opacity:0.8;">Step ${this.tourStepIndex + 1} of ${this.tourSteps.length}</span>
                    <button onclick="settingsController.nextTourStep()" style="background: white; color: var(--text-main); border: none; padding: 8px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display:flex; align-items:center; gap:6px;">
                        ${isLastStep ? 'Finish & Build Timetable <i class="fas fa-arrow-right"></i>' : 'Next Step <i class="fas fa-arrow-right"></i>'}
                    </button>
                </div>
            `;
            
            tooltip.style.display = 'flex';
            setTimeout(() => {
                tooltip.style.opacity = '1';
                tooltip.style.transform = 'translateX(-50%) translateY(0)';
            }, 300);
        }
    },

    nextTourStep() {
        const tooltip = document.getElementById('tour-tooltip');
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => {
            this.tourStepIndex++;
            this.renderTourStep();
        }, 300);
    },

    endTour() {
        const overlay = document.getElementById('tour-overlay');
        const tooltip = document.getElementById('tour-tooltip');
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => overlay.style.display = 'none', 300);
        }
        if (tooltip) {
            tooltip.style.opacity = '0';
            setTimeout(() => tooltip.style.display = 'none', 300);
        }
        
        document.body.style.overflow = '';
        
        this.tourSteps.forEach(step => {
            const el = document.getElementById(step.id);
            if (el) {
                el.style.zIndex = '1';
                el.style.boxShadow = 'var(--shadow-md)';
                el.style.pointerEvents = 'auto';
            }
        });
        
        window.app.showToast("Setup complete! Opening Timetable Builder...");
        // Auto-navigate user to Timetable
        setTimeout(() => {
            window.router.loadView('timetable');
        }, 500);
    },

    // --- PERIOD MANAGEMENT WITH AUTO-SORT ---
    sortPeriodsChronologically() {
        if (!window.appState.rawPeriods) return;
        window.appState.rawPeriods.sort((a, b) => {
            const timeA = (a.startTime || '00:00').padStart(5, '0');
            const timeB = (b.startTime || '00:00').padStart(5, '0');
            return timeA.localeCompare(timeB);
        });
        window.appState.rawPeriods.forEach((p, idx) => {
            p.sortOrder = idx + 1;
        });
    },

    renderPeriodSettings() {
        const container = document.getElementById('period-settings-list');
        if(!container) return;
        
        this.sortPeriodsChronologically();

        let html = '';
        (window.appState.rawPeriods || []).forEach((p, i) => {
            html += `<div style="display:flex; gap:10px; align-items:center;">
                <input type="text" class="form-control" style="flex:2;" value="${p.label || ''}" placeholder="Name (e.g. Period 1)" onchange="window.appState.rawPeriods[${i}].label = this.value">
                <input type="time" class="form-control" style="flex:1;" value="${p.startTime || '09:00'}" onchange="window.appState.rawPeriods[${i}].startTime = this.value; settingsController.renderPeriodSettings();">
                <input type="time" class="form-control" style="flex:1;" value="${p.endTime || '10:00'}" onchange="window.appState.rawPeriods[${i}].endTime = this.value">
                <select class="form-control" style="flex:1;" onchange="window.appState.rawPeriods[${i}].isBreak = (this.value === 'true')">
                    <option value="false" ${!p.isBreak ? 'selected' : ''}>Lesson</option>
                    <option value="true" ${p.isBreak ? 'selected' : ''}>Break/Lunch</option>
                </select>
                <button type="button" class="btn-icon" style="color:#ef4444;" onclick="settingsController.removePeriodRow(${i})"><i class="fas fa-trash"></i></button>
            </div>`;
        });
        container.innerHTML = html;
    },

    addPeriodRow(isBreak) {
        if(!window.appState.rawPeriods) window.appState.rawPeriods = [];
        
        // Auto-calculate the time so the new period appends to the bottom
        let nextStart = '09:00';
        let nextEnd = '10:00';
        
        if (window.appState.rawPeriods.length > 0) {
            // Find the latest ending period
            const latestPeriod = [...window.appState.rawPeriods].sort((a, b) => b.endTime.localeCompare(a.endTime))[0];
            if (latestPeriod && latestPeriod.endTime) {
                nextStart = latestPeriod.endTime;
                // Add 1 hour for the default end time
                let [h, m] = nextStart.split(':').map(Number);
                h = (h + 1) % 24;
                nextEnd = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            }
        }

        window.appState.rawPeriods.push({ 
            label: isBreak ? 'Break' : 'New Period', 
            startTime: nextStart, 
            endTime: nextEnd, 
            isBreak: !!isBreak, 
            sortOrder: window.appState.rawPeriods.length + 1 
        });
        
        this.renderPeriodSettings();
    },

    removePeriodRow(index) {
        window.appState.rawPeriods.splice(index, 1);
        this.renderPeriodSettings();
    },

    async savePeriods(btn) {
        const orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        this.sortPeriodsChronologically();
        try {
            const res = await fetch('/api/periods', { 
                method: 'POST', 
                headers: {'Content-Type':'application/json'}, 
                body: JSON.stringify({ periods: window.appState.rawPeriods }) 
            });
            btn.innerHTML = orig; 
            if (res.ok) {
                window.app.showToast("School Day Structure Sorted & Saved!");
                this.renderPeriodSettings();
            } else {
                window.app.showToast("Saved locally");
            }
        } catch(e) {
            btn.innerHTML = orig; 
            alert("Failed to save periods: " + e.message);
        }
    },

    formatToUK(ymd) {
        if(!ymd) return '';
        const parts = ymd.split('-');
        if(parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return ymd;
    },

    parseFromUK(dateStr) {
        const d = String(dateStr || '').trim();
        if(!d) return '2026-08-31';
        if(d.includes('/')) { const p = d.split('/'); return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
        if(d.includes('-')) { 
            const p = d.split('-'); 
            if(p[0].length === 2) return `${p[2]}-${p[1]}-${p[0]}`;
        }
        return d;
    },

    async saveDataSettings(btn) {
        const original = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        const termStartRaw = document.getElementById('setting-term-start').value;
        const holidaysRaw = document.getElementById('setting-holidays').value;
        
        const termStartVal = this.parseFromUK(termStartRaw);
        const holidaysVal = holidaysRaw.split(',').map(s => this.parseFromUK(s)).join(',');

        await fetch('/api/settings/ai', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ termStart: termStartVal, holidays: holidaysVal }) });
        
        window.termStart = new Date(termStartVal); 
        if(isNaN(window.termStart)) window.termStart = new Date("2026-08-31T00:00:00");
        window.holidays = holidaysVal.split(',').map(s=>s.trim());
        
        btn.innerHTML = original; 
        window.app.showToast("Calendar Saved");
    },

    async saveAISettings(btn) {
        const orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        const provider = document.getElementById('setting-ai-provider').value;
        const apiKey = document.getElementById('setting-ai-key').value;
        await fetch('/api/settings/ai', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ provider, apiKey }) });
        btn.innerHTML = orig; 
        window.app.showToast("AI Settings Saved");
    },

    async addRoom() {
        const name = document.getElementById('new-room-input').value;
        if(!name) return;
        await fetch('/api/rooms', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
        document.getElementById('new-room-input').value = '';
        window.app.showToast("Room Added");
        
        const resR = await fetch('/api/rooms');
        if(resR.ok) {
            window.appState.rooms = await resR.json();
            this.populateExistingSettings();
        }
    },

    async handleMasterFile(event) {
        const file = event.target.files[0]; if(!file) return;
        const output = document.getElementById('master-csv-output');
        const progContainer = document.getElementById('import-progress-container');
        const progFill = document.getElementById('import-progress-fill');
        
        progContainer.style.display = 'block'; 
        let prog = 5;
        const fakeZipProg = setInterval(() => {
            if(prog < 40) { prog += 5; progFill.style.width = prog + '%'; progFill.innerText = prog + '%'; }
        }, 200);

        output.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Reading Data...';

        const reader = new FileReader();
        reader.onload = async function(evt) {
            clearInterval(fakeZipProg);
            const data = evt.target.result;
            const workbook = window.XLSX.read(data, {type: 'binary'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rawRows = window.XLSX.utils.sheet_to_json(firstSheet, {header: 1, defval: ''});
            let headerIdx = rawRows.findIndex(r => r.some(c => typeof c === 'string' && (c.toLowerCase() === 'name' || c.toLowerCase() === 'student name' || c.toLowerCase() === 'first name')));
            if (headerIdx === -1) headerIdx = 0; 
            const headers = rawRows[headerIdx];
            
            const m = {
                name: headers.findIndex(h => h && (h.toLowerCase() === 'name' || h.toLowerCase() === 'legal name' || h.toLowerCase() === 'student name')),
                fname: headers.findIndex(h => h && (h.toLowerCase() === 'first name' || h.toLowerCase() === 'legal forename')),
                lname: headers.findIndex(h => h && (h.toLowerCase() === 'last name' || h.toLowerCase() === 'legal surname')),
                class: headers.findIndex(h => h && h.toLowerCase().includes('courses/classes')),
            };

            let unmapped = 0; let fullSchoolRoster = [];

            for (let i = headerIdx + 1; i < rawRows.length; i++) {
                const row = rawRows[i];
                if (!row || row.length === 0) continue;
                let fullName = m.name !== -1 ? row[m.name] : '';
                let fName = m.fname !== -1 ? row[m.fname] : '';
                let lName = m.lname !== -1 ? row[m.lname] : '';
                if (!fullName && fName && lName) fullName = `${lName}, ${fName}`;
                if (!fullName) { unmapped++; continue; }

                const id = fullName.replace(/\s/g, '');
                const classNameList = m.class !== -1 ? row[m.class] : '';

                fullSchoolRoster.push({ id, name: fullName, classes: classNameList });
            }
            
            await window.idb.set('wholeSchoolRoster', fullSchoolRoster);

            progFill.style.width = '100%';
            progFill.innerText = '100%';
            output.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Extracted ${fullSchoolRoster.length} students! Go to Timetable Builder to search & pin your classes.</span>`;
            setTimeout(() => { if(progContainer) progContainer.style.display = 'none'; }, 4000);
        };
        reader.readAsBinaryString(file);
    },

    async wipeRostersOnly() {
        if(!confirm("Wipe all students, classes, and timetables from Database?")) return;
        const btn = document.getElementById('wipe-btn');
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wiping Database... 0%';
        btn.style.pointerEvents = 'none';
        
        let pct = 0;
        const fakeInt = setInterval(() => {
            if(pct < 85) { pct += 5; btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Wiping Database... ${pct}%`; }
        }, 100);

        try {
            await fetch('/api/auth/nuke-rosters', { method: 'POST' });
            await window.idb.set('wholeSchoolRoster', []);
            localStorage.setItem('pinnedClasses', JSON.stringify([]));

            clearInterval(fakeInt);
            btn.innerHTML = '<i class="fas fa-check-circle"></i> Wiped 100%';
            window.app.showToast("Database Cleared"); 
            setTimeout(() => window.location.reload(true), 600);
        } catch(e) {
            clearInterval(fakeInt);
            btn.innerHTML = origHTML;
            btn.style.pointerEvents = 'auto';
            alert("Wipe Failed: " + e.message);
        }
    }
};
