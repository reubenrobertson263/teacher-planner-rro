window.settingsController = {
    init() {
        this.renderPeriodSettings();
        this.populateExistingSettings();
    },

    populateExistingSettings() {
        const savedTheme = localStorage.getItem('flowdesk-theme') || 'light';
        const savedFont = localStorage.getItem('flowdesk-font') || 'standard';
        const themeSel = document.getElementById('setting-theme');
        if(themeSel) themeSel.value = savedTheme;
        const fontSel = document.getElementById('setting-font');
        if(fontSel) fontSel.value = savedFont;

        const settingsRoomList = document.getElementById('settings-room-list'); 
        if(settingsRoomList && window.appState.rooms) {
            settingsRoomList.innerHTML = '';
            window.appState.rooms.forEach(r => {
                settingsRoomList.innerHTML += `<li style="padding: 6px 0; border-bottom: 1px solid var(--border);">${r.name}</li>`;
            });
        }
    },

    renderPeriodSettings() {
        const container = document.getElementById('period-settings-list');
        if(!container) return;
        let html = '';
        (window.appState.rawPeriods || []).forEach((p, i) => {
            html += `<div style="display:flex; gap:10px; align-items:center;">
                <input type="text" class="form-control" style="flex:2;" value="${p.label}" placeholder="Name (e.g. Period 1)" onchange="window.appState.rawPeriods[${i}].label = this.value">
                <input type="time" class="form-control" style="flex:1;" value="${p.startTime}" onchange="window.appState.rawPeriods[${i}].startTime = this.value">
                <input type="time" class="form-control" style="flex:1;" value="${p.endTime}" onchange="window.appState.rawPeriods[${i}].endTime = this.value">
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
        window.appState.rawPeriods.push({ label: isBreak ? 'Break' : 'New Period', startTime: '09:00', endTime: '10:00', isBreak, sortOrder: window.appState.rawPeriods.length+1 });
        this.renderPeriodSettings();
    },

    removePeriodRow(index) {
        window.appState.rawPeriods.splice(index, 1);
        this.renderPeriodSettings();
    },

    async savePeriods(btn) {
        const orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
            await fetch('/api/periods', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ periods: window.appState.rawPeriods }) });
            btn.innerHTML = orig; 
            window.app.showToast("School Day Saved!");
        } catch(e) {
            btn.innerHTML = orig; 
            alert("Failed to save periods");
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
