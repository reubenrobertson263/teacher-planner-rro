window.settingsController = {
    tourStepIndex: 0,
    tourSteps: [
        { id: 'card-arbor', title: 'Step 1: Upload Arbor Data', text: 'Upload your master Excel file here. This extracts all student names and profile pictures so you can build seating plans.' },
        { id: 'card-periods', title: 'Step 2: Define School Day', text: 'Set your exact timetable periods. FlowDesk auto-sorts them chronologically so they always stay in order!' },
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
                if (Array.isArray(data) && data.length > 0) window.appState.rawPeriods = data;
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
            tooltip.style.cssText = 'position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%) translateY(20px); background: var(--accent); color: white; padding: 20px; border-radius: 12px; z-index: 100000; width: 90%; max-width: 440px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); display: none; flex-direction: column; gap: 10px; opacity: 0; transition: opacity 0.3s ease, transform 0.3s ease;';
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
            if (el) { el.style.zIndex = '1'; el.style.boxShadow = 'var(--shadow-md)'; el.style.pointerEvents = 'none'; }
        });

        if (this.tourStepIndex >= this.tourSteps.length) {
            this.endTour(); return;
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
            
            scrollContainer.scrollTo({ top: scrollContainer.scrollTop + (cardRect.top - containerRect.top) - 40, behavior: 'smooth' });

            const isLastStep = this.tourStepIndex === this.tourSteps.length - 1;

            tooltip.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0; font-size:1.1em; font-weight:800;">${step.title}</h3>
                    <button onclick="settingsController.endTour()" style="background:transparent; border:none; color:white; opacity:0.8; font-size:0.85em; cursor:pointer; text-decoration:underline;">Skip Tour</button>
                </div>
                <p style="margin:0; font-size:0.95em; line-height:1.5;">${step.text}</p>
                <div style="display:flex; justify-content:space-between; margin-top:10px; align-items:center;">
                    <span style="font-size:0.8em; opacity:0.8;">Step ${this.tourStepIndex + 1} of ${this.tourSteps.length}</span>
                    <button onclick="settingsController.nextTourStep()" style="background: white; color: var(--text-main); border: none; padding: 8px 18px; border-radius: 6px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display:flex; align-items:center; gap:6px;">
                        ${isLastStep ? 'Finish & Build Timetable <i class="fas fa-arrow-right"></i>' : 'Next Step <i class="fas fa-arrow-right"></i>'}
                    </button>
                </div>
            `;
            
            tooltip.style.display = 'flex';
            setTimeout(() => { tooltip.style.opacity = '1'; tooltip.style.transform = 'translateX(-50%) translateY(0)'; }, 300);
        }
    },

    nextTourStep() {
        const tooltip = document.getElementById('tour-tooltip');
        tooltip.style.opacity = '0';
        tooltip.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => { this.tourStepIndex++; this.renderTourStep(); }, 300);
    },

    endTour() {
        const overlay = document.getElementById('tour-overlay');
        const tooltip = document.getElementById('tour-tooltip');
        if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.style.display = 'none', 300); }
        if (tooltip) { tooltip.style.opacity = '0'; setTimeout(() => tooltip.style.display = 'none', 300); }
        
        document.body.style.overflow = '';
        this.tourSteps.forEach(step => {
            const el = document.getElementById(step.id);
            if (el) { el.style.zIndex = '1'; el.style.boxShadow = 'var(--shadow-md)'; el.style.pointerEvents = 'auto'; }
        });
        
        window.app.showToast("Setup complete! Opening Timetable Builder...");
        setTimeout(() => { window.router.loadView('timetable'); }, 300);
    },

    sortPeriodsChronologically() {
        if (!window.appState.rawPeriods) return;
        window.appState.rawPeriods.sort((a, b) => {
            const timeA = (a.startTime || '00:00').padStart(5, '0');
            const timeB = (b.startTime || '00:00').padStart(5, '0');
            return timeA.localeCompare(timeB);
        });
        window.appState.rawPeriods.forEach((p, idx) => { p.sortOrder = idx + 1; });
    },

    renderPeriodSettings() {
        const container = document.getElementById('period-settings-list');
        if(!container) return;
        
        this.sortPeriodsChronologically();

        let html = '';
        (window.appState.rawPeriods || []).forEach((p, i) => {
            html += `<div style="display:flex; gap:10px; align-items:center;">
                <input type="text" class="form-control" style="flex:2;" value="${p.label || ''}" placeholder="Name (e.g. Period 1)" onchange="window.appState.rawPeriods[${i}].label = this.value">
                <input type="time" class="form-control" style="flex:1;" value="${p.startTime || '09:00'}" onchange="window.appState.rawPeriods[${i}].startTime = this.value">
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
        let nextStart = '09:00'; let nextEnd = '10:00';
        
        if (window.appState.rawPeriods.length > 0) {
            const latestPeriod = [...window.appState.rawPeriods].sort((a, b) => b.endTime.localeCompare(a.endTime))[0];
            if (latestPeriod && latestPeriod.endTime) {
                nextStart = latestPeriod.endTime;
                let [h, m] = nextStart.split(':').map(Number);
                h = (h + 1) % 24;
                nextEnd = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            }
        }
        window.appState.rawPeriods.push({ label: isBreak ? 'Break' : 'New Period', startTime: nextStart, endTime: nextEnd, isBreak: !!isBreak, sortOrder: window.appState.rawPeriods.length + 1 });
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
            const res = await fetch('/api/periods', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ periods: window.appState.rawPeriods }) });
            btn.innerHTML = orig; 
            if (res.ok) { window.app.showToast("School Day Structure Sorted & Saved!"); this.renderPeriodSettings(); }
        } catch(e) {
            btn.innerHTML = orig; alert("Failed to save periods");
        }
    },

    formatToUK(ymd) {
        if(!ymd) return ''; const parts = ymd.split('-');
        if(parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return ymd;
    },

    parseFromUK(dateStr) {
        const d = String(dateStr || '').trim();
        if(!d) return '2026-08-31';
        if(d.includes('/')) { const p = d.split('/'); return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`; }
        if(d.includes('-')) { const p = d.split('-'); if(p[0].length === 2) return `${p[2]}-${p[1]}-${p[0]}`; }
        return d;
    },

    async saveDataSettings(btn) {
        const original = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        const termStartRaw = document.getElementById('setting-term-start').value;
        const holidaysRaw = document.getElementById('setting-holidays').value;
        
        const termStartVal = this.parseFromUK(termStartRaw);
        const holidaysVal = holidaysRaw.split(',').map(s => this.parseFromUK(s)).join(',');

        localStorage.setItem('flowdesk-termStart', termStartVal);
        localStorage.setItem('flowdesk-holidays', holidaysVal);
        window.termStart = new Date(termStartVal);
        window.holidays = holidaysVal.split(',').map(s => s.trim());

        await fetch('/api/settings/ai', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ termStart: termStartVal, holidays: holidaysVal }) });
        
        btn.innerHTML = original; window.app.showToast("Calendar Saved");
    },

    async saveAISettings(btn) {
        const orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        const provider = document.getElementById('setting-ai-provider').value;
        const apiKey = document.getElementById('setting-ai-key').value;
        await fetch('/api/settings/ai', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ provider, apiKey }) });
        btn.innerHTML = orig; window.app.showToast("AI Settings Saved");
    },

    async addRoom() {
        const name = document.getElementById('new-room-input').value;
        if(!name) return;
        await fetch('/api/rooms', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name }) });
        document.getElementById('new-room-input').value = '';
        window.app.showToast("Room Added");
        const resR = await fetch('/api/rooms');
        if(resR.ok) { window.appState.rooms = await resR.json(); this.populateExistingSettings(); }
    },

    // --- NON-BLOCKING IMAGE EXTRACTOR ---
    async extractExcelImages(file) {
        if (!/\.xlsx$/i.test(file.name)) return {};
        try {
            const zip = await JSZip.loadAsync(file);
            const drawings = Object.keys(zip.files).filter(name => /^xl\/drawings\/drawing\d+\.xml$/i.test(name));
            const finalImages = {};
            
            for (const drawingPath of drawings) {
                const relPath = drawingPath.replace('xl/drawings/', 'xl/drawings/_rels/') + '.rels';
                const drawingFile = zip.file(drawingPath);
                const relFile = zip.file(relPath);
                if (!drawingFile || !relFile) continue;
                
                const [drawingText, relText] = await Promise.all([drawingFile.async('text'), relFile.async('text')]);
                const relations = {};
                for (const match of relText.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
                    relations[match[1]] = match[2].replace(/^\.\.\//, 'xl/');
                }
                
                const anchors = drawingText.split(/<xdr:(?:twoCellAnchor|oneCellAnchor)>/i).slice(1);
                
                for (const anchor of anchors) {
                    const rowMatch = anchor.match(/<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/i);
                    const embedMatch = anchor.match(/<a:blip[^>]*r:embed="([^"]+)"/i);
                    if (!rowMatch || !embedMatch) continue;
                    
                    const imagePath = relations[embedMatch[1]];
                    const imageFile = imagePath ? zip.file(imagePath) : null;
                    if (!imageFile) continue;
                    
                    const base64 = await imageFile.async('base64');
                    const extension = imagePath.split('.').pop().toLowerCase();
                    const mime = extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : 'image/jpeg';
                    finalImages[Number(rowMatch[1])] = `data:${mime};base64,${base64}`;
                    
                    // CRITICAL FIX: Yield to the main thread so the browser doesn't freeze
                    await new Promise(r => setTimeout(r, 0));
                }
            }
            return finalImages;
        } catch (error) {
            console.warn('Image extraction failed', error);
            return {};
        }
    },

    async handleMasterFile(event) {
        const file = event.target.files[0]; if(!file) return;
        const output = document.getElementById('master-csv-output');
        const progContainer = document.getElementById('import-progress-container');
        const progFill = document.getElementById('import-progress-fill');
        
        if (!output || !progContainer || !progFill) return;

        progContainer.style.display = 'block'; 
        progFill.style.width = '10%';
        progFill.innerText = 'Extracting Images...';

        output.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing Arbor Data...';

        try {
            if (typeof XLSX === 'undefined') throw new Error('XLSX Library not loaded yet. Please wait a second and try again.');

            const [arrayBuffer, imageMap] = await Promise.all([file.arrayBuffer(), this.extractExcelImages(file)]);
            
            progFill.style.width = '50%';
            progFill.innerText = 'Parsing Arbor Spreadsheet...';
            await new Promise(r => setTimeout(r, 0)); // Yield

            const workbook = XLSX.read(arrayBuffer, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rawRows = XLSX.utils.sheet_to_json(firstSheet, {header: 1, defval: ''});
            
            let headerIdx = rawRows.findIndex(r => r.some(c => typeof c === 'string' && (c.toLowerCase() === 'name' || c.toLowerCase() === 'student name' || c.toLowerCase() === 'first name')));
            if (headerIdx === -1) headerIdx = 0; 
            const headers = rawRows[headerIdx];
            
            const m = {
                name: headers.findIndex(h => h && (h.toLowerCase() === 'name' || h.toLowerCase() === 'legal name' || h.toLowerCase() === 'student name')),
                fname: headers.findIndex(h => h && (h.toLowerCase() === 'first name' || h.toLowerCase() === 'legal forename')),
                lname: headers.findIndex(h => h && (h.toLowerCase() === 'last name' || h.toLowerCase() === 'legal surname')),
                year: headers.findIndex(h => h && h.toLowerCase().includes('year group')),
                class: headers.findIndex(h => h && h.toLowerCase().includes('courses/classes')),
                sex: headers.findIndex(h => h && (h.toLowerCase() === 'sex' || h.toLowerCase() === 'gender')),
                id: headers.findIndex(h => h && (h.toLowerCase() === 'upn' || h.toLowerCase() === 'student id')),
                sen: headers.findIndex(h => h && h.toLowerCase().includes('sen status')),
                fsm: headers.findIndex(h => h && h.toLowerCase().includes('fsm')),
                cat: headers.findIndex(h => h && h.toLowerCase().includes('cat mean'))
            };

            const fullSchoolRoster = [];
            let uniqueClasses = new Set();

            progFill.style.width = '80%';
            progFill.innerText = 'Building Database...';
            await new Promise(r => setTimeout(r, 0)); // Yield

            for (let i = headerIdx + 1; i < rawRows.length; i++) {
                const row = rawRows[i];
                if (!row || row.length === 0) continue;
                
                let fullName = m.name !== -1 ? row[m.name] : '';
                let fName = m.fname !== -1 ? row[m.fname] : '';
                let lName = m.lname !== -1 ? row[m.lname] : '';
                if (!fullName && fName && lName) fullName = `${lName}, ${fName}`;
                if (!fullName) continue;

                const id = (m.id !== -1 ? String(row[m.id]) : '') || fullName.replace(/\s/g, '');
                
                // --- THE ARBOR STRING SLICER ---
                // Safely extracts class codes like "10a/En1" from massive string dumps
                let rawClasses = m.class !== -1 ? row[m.class] : '';
                let cleanClassList = [];
                if (rawClasses) {
                    const sections = String(rawClasses).split(',');
                    sections.forEach(sec => {
                        const colonParts = sec.split(':');
                        if (colonParts.length > 2) {
                            const codePart = colonParts[colonParts.length - 1];
                            const cleanedCode = codePart.split('(')[0].trim();
                            if (cleanedCode && !cleanClassList.includes(cleanedCode)) {
                                cleanClassList.push(cleanedCode);
                                uniqueClasses.add(cleanedCode);
                            }
                        } else {
                            const cleanedCode = sec.split('(')[0].trim();
                            if (cleanedCode && !cleanClassList.includes(cleanedCode)) {
                                cleanClassList.push(cleanedCode);
                                uniqueClasses.add(cleanedCode);
                            }
                        }
                    });
                }
                const parsedClasses = cleanClassList.join(', ');

                const photo = imageMap[i] || null; 
                const year = m.year !== -1 ? row[m.year] : 'Unknown';
                const sex = m.sex !== -1 ? row[m.sex] : null;
                const senRaw = m.sen !== -1 ? String(row[m.sen]).toLowerCase() : 'no';
                const fsmRaw = m.fsm !== -1 ? String(row[m.fsm]).toLowerCase() : 'no';
                const catMean = m.cat !== -1 ? row[m.cat] : '';

                fullSchoolRoster.push({ 
                    id, name: fullName, year, sex, classes: parsedClasses, photo, 
                    sen: senRaw !== 'no' && senRaw !== 'no special educational need' && senRaw !== '', 
                    fsm: fsmRaw === 'yes' || fsmRaw === 'true', catMean 
                });
            }
            
            await window.idb.set('wholeSchoolRoster', fullSchoolRoster);

            progFill.style.width = '100%';
            progFill.innerText = 'Complete!';
            output.innerHTML = `<span style="color:#10b981;"><i class="fas fa-check-circle"></i> Extracted ${fullSchoolRoster.length} students & ${uniqueClasses.size} classes!</span>`;
            setTimeout(() => { if(progContainer) progContainer.style.display = 'none'; }, 3000);

        } catch (error) {
            output.innerHTML = `<span style="color:#ef4444;"><i class="fas fa-exclamation-triangle"></i> Error: ${error.message}</span>`;
            progContainer.style.display = 'none';
        } finally {
            if (event.target) event.target.value = '';
        }
    },

    async wipeRostersOnly() {
        if (!confirm('Wipe your students, classes, seating plans, lesson links and timetables?')) return;
        const button = document.getElementById('wipe-btn');
        const original = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wiping…'; button.disabled = true;
        try {
            await fetch('/api/auth/nuke-rosters', { method: 'POST' });
            await window.idb.set('wholeSchoolRoster', []);
            localStorage.removeItem('pinnedClasses');
            window.app.showToast('Your roster data was cleared');
            setTimeout(() => window.location.reload(true), 600);
        } catch (error) { alert(error.message); }
        finally { button.innerHTML = original; button.disabled = false; }
    }
};
