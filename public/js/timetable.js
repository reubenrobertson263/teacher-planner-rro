// public/js/timetable.js
window.timetableController = {
    dayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],

    async init() {
        // INSTANT CACHE RENDER
        this.renderClassSettingsUI();
        this.renderDnDGrid();

        // Background network sync
        await this.loadInitialData();
        await this.renderClassSettingsUI();
        this.renderDnDGrid();
    },

    async loadInitialData() {
        try {
            const [resP, resC, resT] = await Promise.all([
                fetch('/api/periods'),
                fetch('/api/classes'),
                fetch('/api/timetable')
            ]);
            if (resP.ok) {
                window.appState.rawPeriods = await resP.json();
                if (window.settingsController) window.settingsController.sortPeriodsChronologically();
            }
            if (resC.ok) window.appState.classes = await resC.json();
            if (resT.ok) window.appState.blocks = await resT.json();
        } catch(e) {}
    },

    getTextColor(hex) {
        if (!hex) return '#111827';
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#111827' : '#ffffff';
    },

    previewClassColor(classId, hexColor) {
        const pill = document.getElementById('c-' + classId);
        if (pill) {
            pill.style.backgroundColor = hexColor;
            pill.style.borderColor = hexColor;
            pill.style.color = this.getTextColor(hexColor);
        }
        document.querySelectorAll(`.draggable-item[data-classid="${classId}"]`).forEach(block => {
            block.style.backgroundColor = hexColor;
            block.style.borderColor = hexColor;
            block.style.color = this.getTextColor(hexColor);
        });
    },

    async saveClassColor(classId, hexColor) {
        try {
            const res = await fetch(`/api/classes/${classId}/color`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colorHex: hexColor })
            });
            if (res.ok) {
                const cls = (window.appState.classes || []).find(c => c.id === classId);
                if (cls) cls.colorHex = hexColor;
            }
        } catch(e) {}
    },

    dragEntity(ev, id, type, sourceDay = null, sourcePeriod = null) {
        ev.dataTransfer.effectAllowed = 'copyMove';
        ev.dataTransfer.setData("text/plain", JSON.stringify({
            id, type, sourceDay, sourcePeriod,
            isClone: ev.ctrlKey || ev.altKey || ev.metaKey
        }));
    },

    allowDrop(ev) { 
        ev.preventDefault(); 
        ev.target.classList.add('drag-over'); 
    },

    dragLeave(ev) { 
        ev.target.classList.remove('drag-over'); 
    },

    dropToTimetable(ev) {
        ev.preventDefault(); 
        ev.target.classList.remove('drag-over');
        
        let payload;
        try { payload = JSON.parse(ev.dataTransfer.getData("text/plain")); } 
        catch(e) { return; }
        
        const data = payload.id;
        const type = payload.type;
        const target = ev.target.closest('.drop-zone');
        if(!target) return;
        
        const day = parseInt(target.getAttribute('data-day'));
        const period = target.getAttribute('data-period');
        const weekSelect = document.getElementById('builder-week-select');
        const selectedWeek = weekSelect ? weekSelect.value : 'A';
        
        // Move vs Clone: If Ctrl was not held and it came from the grid, delete the old instance
        if (payload.sourceDay && payload.sourcePeriod && !payload.isClone && !ev.ctrlKey && !ev.altKey) {
            this.removeBlock(payload.sourceDay, payload.sourcePeriod, selectedWeek);
        }

        window.appState.blocks = (window.appState.blocks || []).filter(b => !(b.dayOfWeek === day && String(b.period) === String(period) && b.weekType === selectedWeek));
        
        if (type === 'CLASS') {
            const classId = data.replace('c-', '');
            const cls = (window.appState.classes || []).find(c => c.id === classId);
            if (cls) {
                window.appState.blocks.push({ entryType: 'CLASS', classId: cls.id, class: cls, dayOfWeek: day, period: period, weekType: selectedWeek });
            }
        } else {
            window.appState.blocks.push({ entryType: 'CUSTOM', label: data, dayOfWeek: day, period: period, weekType: selectedWeek });
        }
        this.renderDnDGrid();
    },

    renderDnDGrid() {
        const grid = document.getElementById('dnd-master-grid'); 
        if(!grid) return;
        
        let html = '<div></div>';
        this.dayNames.forEach(day => html += `<div style="text-align:center; font-weight:700; padding:10px; color:var(--text-muted);">${day}</div>`);
        
        const weekSelect = document.getElementById('builder-week-select');
        const selectedWeek = weekSelect ? weekSelect.value : 'A';
        const periods = window.appState.rawPeriods || [];

        periods.forEach((p, idx) => {
            const periodId = p.id || (idx + 1);
            html += `<div style="text-align:right; font-size:0.85em; color:var(--text-muted); padding-right:15px; margin-top: 15px; font-weight:700;">${p.label}<br><span style="font-weight:normal; font-size:0.8em; color:var(--text-muted);">${p.startTime} - ${p.endTime}</span></div>`;
            
            if(p.isBreak) {
                html += `<div style="grid-column: span 5; background: var(--border); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; font-weight: bold; color: var(--text-muted); letter-spacing: 2px; text-transform: uppercase; min-height: 40px;">${p.label}</div>`;
            } else {
                for(let i = 1; i <= 5; i++) {
                    const existingBlock = (window.appState.blocks || []).find(b => b.dayOfWeek === i && String(b.period) === String(periodId) && b.weekType === selectedWeek);
                    let innerHtml = '';
                    if (existingBlock) {
                        const isClass = existingBlock.entryType === 'CLASS';
                        const label = isClass && existingBlock.class ? existingBlock.class.name : existingBlock.label;
                        const classId = isClass && existingBlock.class ? existingBlock.class.id : '';
                        const color = isClass && existingBlock.class ? existingBlock.class.colorHex : 'var(--accent)';
                        const textColor = this.getTextColor(color);
                        
                        innerHtml = `<div class="draggable-item" draggable="true" 
                                          data-classid="${classId}"
                                          ondragstart="timetableController.dragEntity(event, '${isClass ? 'c-' + existingBlock.classId : label}', '${existingBlock.entryType}', ${i}, '${periodId}')" 
                                          ondblclick="this.parentElement.innerHTML=''; timetableController.removeBlock(${i}, '${periodId}', '${selectedWeek}');" 
                                          style="background-color: ${color}; border-color: ${color}; color: ${textColor}; margin:0; width:100%; height:100%; min-height: 50px; display:flex; align-items:center; justify-content:center; border-radius:var(--radius-sm); cursor:grab; text-align:center; padding:4px; font-size:0.9em;">
                                          ${label}
                                     </div>`;
                    }
                    html += `<div class="drop-zone" ondrop="timetableController.dropToTimetable(event)" ondragover="timetableController.allowDrop(event)" ondragleave="timetableController.dragLeave(event)" data-day="${i}" data-period="${periodId}" style="padding:4px; min-height:60px;">${innerHtml}</div>`;
                }
            }
        });
        grid.innerHTML = html;
    },

    removeBlock(day, period, weekType) {
        window.appState.blocks = (window.appState.blocks || []).filter(b => !(b.dayOfWeek === day && String(b.period) === String(period) && b.weekType === weekType));
    },

    async saveTimetable(btn) {
        const weekSelect = document.getElementById('builder-week-select');
        const selectedWeek = weekSelect ? weekSelect.value : 'A';
        const blocksToSave = (window.appState.blocks || []).filter(b => b.weekType === selectedWeek);
        
        const orig = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        try {
            await fetch('/api/timetable', { 
                method: 'POST', headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify({ blocks: blocksToSave, weekType: selectedWeek }) 
            });
            btn.innerHTML = orig; 
            window.app.showToast(`Week ${selectedWeek} Timetable Saved!`);
        } catch(e) {
            btn.innerHTML = orig;
            alert("Error saving timetable");
        }
    },

    async renderClassSettingsUI() {
        const allList = document.getElementById('all-classes-list');
        const roster = await window.idb.get('wholeSchoolRoster') || [];
        
        let uniqueClasses = new Set();
        roster.forEach(s => {
            if(s.classes) s.classes.split(',').forEach(c => uniqueClasses.add(c.trim()));
        });

        if (allList) {
            allList.innerHTML = '';
            Array.from(uniqueClasses).sort().forEach(c => {
                allList.innerHTML += `<option value="${c}"></option>`;
            });
        }

        let pinnedClasses = JSON.parse(localStorage.getItem('pinnedClasses')) || [];
        (window.appState.blocks || []).forEach(b => {
            if (b.entryType === 'CLASS' && b.classId && !pinnedClasses.includes(b.classId)) {
                pinnedClasses.push(b.classId);
            }
        });
        localStorage.setItem('pinnedClasses', JSON.stringify(pinnedClasses));

        const cContainer = document.getElementById('class-list-container'); 
        if(cContainer) cContainer.innerHTML = '';
        
        (window.appState.classes || []).forEach(c => {
            if (pinnedClasses.includes(c.id) && cContainer) {
                const hex = c.colorHex || '#3b82f6';
                const textColor = this.getTextColor(hex);
                
                cContainer.innerHTML += `
                <div style="display:flex; align-items:center; gap: 10px; margin-bottom: 8px;">
                    <input type="color" value="${hex}" title="Change class color"
                           oninput="timetableController.previewClassColor('${c.id}', this.value)"
                           onchange="timetableController.saveClassColor('${c.id}', this.value)"
                           style="width: 32px; height: 32px; border: 1px solid var(--border); border-radius: 4px; padding: 0; cursor: pointer; background: transparent; flex-shrink: 0;">
                    
                    <div style="flex:1;">
                        <div class="draggable-item" draggable="true" ondragstart="timetableController.dragEntity(event, 'c-${c.id}', 'CLASS')" id="c-${c.id}" style="background-color: ${hex}; border-color: ${hex}; color: ${textColor}; font-size:0.95em; border-radius:var(--radius-sm); margin:0; padding:10px; text-align:center;">
                            ${c.name} (${c.students ? c.students.length : 0})
                        </div>
                    </div>
                </div>`;
            }
        });
    },

    async pinClassToSidebar() {
        const input = document.getElementById('timetable-class-search');
        const className = input.value.trim();
        if(!className) return;

        const roster = await window.idb.get('wholeSchoolRoster');
        if(!roster || roster.length === 0) return alert("Upload Arbor Master File in Settings first.");
        
        const classStudents = roster.filter(s => s.classes && s.classes.split(',').map(x=>x.trim()).includes(className));
        if(classStudents.length === 0) return alert("Class not found in Arbor data.");

        input.value = 'Importing...';
        input.disabled = true;

        const payload = classStudents.map(s => ({ externalRef: s.id, name: s.name, className: className }));

        const res = await fetch('/api/students/bulk-import', { 
            method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ students: payload, className: className }) 
        });
        const data = await res.json();

        let pinnedClasses = JSON.parse(localStorage.getItem('pinnedClasses')) || [];
        if(data.classId && !pinnedClasses.includes(data.classId)) {
            pinnedClasses.push(data.classId);
            localStorage.setItem('pinnedClasses', JSON.stringify(pinnedClasses));
            
            const randomHex = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
            await fetch(`/api/classes/${data.classId}/color`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colorHex: randomHex })
            });
        }

        const resC = await fetch('/api/classes');
        if(resC.ok) window.appState.classes = await resC.json();
        
        input.value = '';
        input.disabled = false;
        await this.renderClassSettingsUI();
    },

    createTimetableElement() {
        const name = document.getElementById('new-elem-name').value;
        if(!name) return;
        const container = document.getElementById('class-list-container');
        container.innerHTML += `<div class="draggable-item" draggable="true" ondragstart="timetableController.dragEntity(event, '${name}', 'CUSTOM')" style="background-color: var(--card); border: 2px solid var(--border); color: var(--text-main); font-size:0.95em; margin-bottom:8px; padding:10px; text-align:center; cursor:grab;">${name}</div>`;
        document.getElementById('new-elem-name').value = '';
    }
};
