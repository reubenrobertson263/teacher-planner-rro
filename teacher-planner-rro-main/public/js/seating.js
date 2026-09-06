window.seatingController = {
    undoStack: [],
    audioContext: null,
    analyser: null,
    noiseStream: null,
    noiseInterval: null,
    bgAltState: false,
    heatmapActive: false, 
    
    async init() {
        // Global classes and seating plans are hydrated by the router before init() runs.
        const sel = document.getElementById('seating-class-select');
        if (sel) {
            sel.innerHTML = '<option value="">Select a Class...</option>' + (window.appState.classes || []).map(c => `<option value="${c.id}">${window.app.escapeHTML(c.name)}</option>`).join('');
        }
    },

    parseLayoutData(plan) {
        if (!plan?.layoutData) return null;
        if (typeof plan.layoutData === 'object') return plan.layoutData;
        try { return JSON.parse(plan.layoutData); } catch (_) { return null; }
    },

    async loadSelectedSeatingPlan() {
        const classId = document.getElementById('seating-class-select')?.value || '';
        const cls = (window.appState.classes || []).find(c => c.id === classId);
        if (!cls) return;

        const plans = window.appState.allSeatingPlans || [];
        const saved = plans.find(plan => plan.classId === classId && (!plan.roomId || plan.roomId === 'default_room')) || plans.find(plan => plan.classId === classId);
        const savedLayout = this.parseLayoutData(saved);

        // If this class has no saved plan, reuse globally-hydrated room geometry rather than
        // resetting desks on view/class load. Only pupil assignments start unseated.
        const geometrySource = savedLayout || plans.map(plan => this.parseLayoutData(plan)).find(layout => Array.isArray(layout?.desks) && layout.desks.length) || null;
        if (geometrySource) {
            window.appState.desks = Array.isArray(geometrySource.desks) ? geometrySource.desks.map(desk => ({ ...desk })) : (window.appState.desks || []);
            window.appState.furniture = Array.isArray(geometrySource.furniture) ? geometrySource.furniture.map(item => ({ ...item })) : (window.appState.furniture || []);
        }

        const assignments = new Map((Array.isArray(savedLayout?.students) ? savedLayout.students : []).map(student => [student.id, student.deskId || null]));
        window.appState.seatingStudents = (cls.students || []).map(student => ({
            ...student,
            deskId: assignments.get(student.id) || null
        }));

        this.undoStack = [];
        this.renderSeatingCanvas();
        this.renderSeatingPool();
    },

    async saveLayout(btn) {
        const classId = document.getElementById('seating-class-select').value;
        if(!classId) return window.app.showToast("Select a class to save this layout");
        
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/seating', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    classId: classId, 
                    roomId: 'default_room', 
                    layoutData: { 
                        desks: window.appState.desks, 
                        furniture: window.appState.furniture, 
                        students: window.appState.seatingStudents 
                    }
                })
            });
            const savedPlan = await response.json().catch(() => null);
            if (!response.ok) throw new Error(savedPlan?.error?.message || 'Error saving layout');
            if (savedPlan?.id) {
                const plans = window.appState.allSeatingPlans || [];
                const index = plans.findIndex(plan => plan.id === savedPlan.id || (plan.classId === classId && plan.roomId === 'default_room'));
                if (index >= 0) plans[index] = savedPlan;
                else plans.push(savedPlan);
                window.appState.allSeatingPlans = plans;
            }
            window.app.showToast("Layout Saved Successfully!");
        } catch(e) {
            alert("Error saving layout");
        } finally {
            btn.innerHTML = orig;
            btn.disabled = false;
        }
    },

    saveStateToHistory() {
        const state = {
            desks: JSON.parse(JSON.stringify(window.appState.desks || [])),
            furniture: JSON.parse(JSON.stringify(window.appState.furniture || [])),
            seatingStudents: JSON.parse(JSON.stringify(window.appState.seatingStudents || []))
        };
        this.undoStack.push(state);
        if(this.undoStack.length > 30) this.undoStack.shift();
    },

    undo() {
        if (this.undoStack.length === 0) return window.app.showToast("Nothing to undo.");
        const lastState = this.undoStack.pop();
        window.appState.desks = lastState.desks;
        window.appState.furniture = lastState.furniture;
        window.appState.seatingStudents = lastState.seatingStudents;
        this.renderSeatingCanvas();
        this.renderSeatingPool();
    },

    async runButtonAction(button, label, action) {
        const original = button?.innerHTML;
        if (button) {
            button.disabled = true;
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i>${label ? ` ${label}` : ''}`;
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
        try { return await action(); }
        finally { if (button) { button.disabled = false; button.innerHTML = original; } }
    },

    async addDesk(button) { 
        return this.runButtonAction(button, 'Adding…', async () => {
            this.saveStateToHistory();
            if (!window.appState.desks) window.appState.desks = [];
            window.appState.desks.push({ id: `desk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, x: 50, y: 50 });
            this.renderSeatingCanvas();
        });
    },

    async addFurniture(type, button) {
        return this.runButtonAction(button, 'Adding…', async () => {
            this.saveStateToHistory();
            if (!window.appState.furniture) window.appState.furniture = [];
            window.appState.furniture.push({ id: `furn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, x: 50, y: 50 });
            this.renderSeatingCanvas();
        });
    },

    async clearDesks(button) {
        return this.runButtonAction(button, 'Wiping…', async () => {
            if (!confirm("Wipe all desks and furniture?")) return;
            this.saveStateToHistory();
            window.appState.desks = [];
            window.appState.furniture = [];
            if (window.appState.seatingStudents) window.appState.seatingStudents.forEach(student => { student.deskId = null; });
            this.renderSeatingCanvas();
            this.renderSeatingPool();
        });
    },

    flipRoom() {
        this.saveStateToHistory();
        const canvas = document.getElementById('seating-canvas');
        if(!canvas) return;
        
        const canvasWidth = canvas.clientWidth;
        const canvasHeight = canvas.clientHeight;
        const deskWidth = 120;
        const deskHeight = 75;

        (window.appState.desks || []).forEach(desk => {
            const newX = canvasWidth - Number(desk.x || 0) - deskWidth;
            const newY = canvasHeight - Number(desk.y || 0) - deskHeight;
            desk.x = Math.max(0, Math.min(canvasWidth - deskWidth, newX));
            desk.y = Math.max(0, Math.min(canvasHeight - deskHeight, newY));
        });
        
        (window.appState.furniture || []).forEach(f => {
            const fw = f.type === 'whiteboard' ? 200 : 120;
            const fh = f.type === 'whiteboard' ? 20 : 60;
            f.x = Math.max(0, Math.min(canvasWidth - fw, canvasWidth - Number(f.x || 0) - fw));
            f.y = Math.max(0, Math.min(canvasHeight - fh, canvasHeight - Number(f.y || 0) - fh));
        });

        this.renderSeatingCanvas();
        window.app.showToast("Room layout flipped 180°");
    },

    unseatAll() {
        this.saveStateToHistory();
        if(window.appState.seatingStudents) window.appState.seatingStudents.forEach(s => s.deskId = null);
        this.renderSeatingCanvas();
        this.renderSeatingPool();
    },

    autoSeat() {
        this.saveStateToHistory();
        const students = window.appState.seatingStudents || [];
        students.forEach(student => { student.deskId = null; });
        const shuffled = [...students].sort(() => Math.random() - 0.5);
        (window.appState.desks || []).forEach((desk, index) => {
            if (shuffled[index]) shuffled[index].deskId = desk.id;
        });
        this.renderSeatingCanvas();
        this.renderSeatingPool();
    },

    alternateBoyGirl() {
        this.saveStateToHistory();
        const pool = window.appState.seatingStudents || [];
        pool.forEach(student => { student.deskId = null; });

        const boys = pool
            .filter(student => student.gender && student.gender.toLowerCase().startsWith('m'))
            .sort(() => Math.random() - 0.5);
        const girls = pool
            .filter(student => student.gender && student.gender.toLowerCase().startsWith('f'))
            .sort(() => Math.random() - 0.5);
        const others = pool.filter(student => !student.gender || (!student.gender.toLowerCase().startsWith('m') && !student.gender.toLowerCase().startsWith('f'))).sort(() => Math.random() - 0.5);

        const arranged = [];
        const max = Math.max(boys.length, girls.length);
        this.bgAltState = !this.bgAltState;

        for (let i = 0; i < max; i += 1) {
            if (this.bgAltState) {
                if (boys[i]) arranged.push(boys[i]);
                if (girls[i]) arranged.push(girls[i]);
            } else {
                if (girls[i]) arranged.push(girls[i]);
                if (boys[i]) arranged.push(boys[i]);
            }
        }
        arranged.push(...others);

        (window.appState.desks || []).forEach((desk, index) => {
            if (arranged[index]) arranged[index].deskId = desk.id;
        });

        this.renderSeatingCanvas();
        this.renderSeatingPool();
    },

    deleteDesk(deskId) {
        const exists = (window.appState.desks || []).some(desk => desk.id === deskId);
        if (!exists) return;
        this.saveStateToHistory();
        window.appState.desks = (window.appState.desks || []).filter(desk => desk.id !== deskId);
        (window.appState.seatingStudents || []).forEach(student => {
            if (student.deskId === deskId) student.deskId = null;
        });
        this.renderSeatingCanvas();
        this.renderSeatingPool();
        window.app.showToast('Desk deleted. Undo is available.');
    },

    heatmapColor(student) {
        if (!student) return '#94a3b8';
        if (student.pp || student.sen) return '#ef4444';
        if (student.fsm) return '#f97316';
        return '#22c55e';
    },

    toggleHeatmap(button) {
        this.heatmapActive = !this.heatmapActive;
        if (button) button.classList.toggle('active', this.heatmapActive);
        this.renderSeatingCanvas();
        this.syncHeatmapButton();
    },

    syncHeatmapButton() {
        const button = document.getElementById('seating-heatmap-btn');
        if (!button) return;
        button.classList.toggle('active', this.heatmapActive);
        button.setAttribute('aria-pressed', this.heatmapActive ? 'true' : 'false');
    },

    allowDrop(ev) { ev.preventDefault(); },

    dragEntity(ev, id, type) { 
        ev.dataTransfer.effectAllowed = 'move'; 
        ev.dataTransfer.setData("id", id); 
        ev.dataTransfer.setData("type", type);
        const rect = ev.target.getBoundingClientRect();
        ev.dataTransfer.setData("offsetX", ev.clientX - rect.left);
        ev.dataTransfer.setData("offsetY", ev.clientY - rect.top);
    },

    dropOnDesk(ev, deskId) {
        ev.preventDefault(); 
        const type = ev.dataTransfer.getData("type"); 
        const id = ev.dataTransfer.getData("id");
        
        if (type === 'student') {
            this.saveStateToHistory();
            const student = window.appState.seatingStudents.find(s => s.id === id);
            if(student) {
                const occupant = window.appState.seatingStudents.find(s => s.deskId === deskId);
                if(occupant) {
                    occupant.deskId = student.deskId; 
                }
                student.deskId = deskId; 
                this.renderSeatingCanvas(); 
                this.renderSeatingPool();
            }
        }
    },

    dropToCanvasVoid(ev) { 
        ev.preventDefault(); 
        const type = ev.dataTransfer.getData("type"); 
        const id = ev.dataTransfer.getData("id");
        const canvas = document.getElementById('seating-canvas');
        if(!canvas) return;
        
        const rect = canvas.getBoundingClientRect();
        const offsetX = parseInt(ev.dataTransfer.getData("offsetX")) || 0;
        const offsetY = parseInt(ev.dataTransfer.getData("offsetY")) || 0;
        
        let targetX = Math.max(0, ev.clientX - rect.left - offsetX);
        let targetY = Math.max(0, ev.clientY - rect.top - offsetY);
        
        if (type === 'desk') {
            this.saveStateToHistory();
            const desk = window.appState.desks.find(d => d.id === id);
            if(desk) { desk.x = targetX; desk.y = targetY; this.renderSeatingCanvas(); }
        } else if (type === 'furniture') {
            this.saveStateToHistory();
            const furn = window.appState.furniture.find(f => f.id === id);
            if(furn) { furn.x = targetX; furn.y = targetY; this.renderSeatingCanvas(); }
        } else if (type === 'student') {
            this.saveStateToHistory();
            const student = window.appState.seatingStudents.find(s => s.id === id); 
            if(student) { student.deskId = null; this.renderSeatingCanvas(); this.renderSeatingPool(); } 
        }
    },

    renderSeatingPool() {
        const pool = document.getElementById('unassigned-pool');
        const count = document.getElementById('pool-count');
        if(!pool) return;
        let html = '';
        const unseated = (window.appState.seatingStudents || []).filter(s => !s.deskId);
        if(count) count.innerText = unseated.length;
        
        unseated.forEach(s => {
            html += `<div style="background:var(--note-bg); border:1px solid var(--border); padding:8px 12px; border-radius:4px; font-size:0.85em; cursor:grab; font-weight:600; white-space:normal; line-height:1.1;" draggable="true" ondragstart="seatingController.dragEntity(event, '${s.id}', 'student')">${window.app.escapeHTML(String(s.name || ''))}</div>`;
        });
        pool.innerHTML = html;
    },

    renderSeatingCanvas() {
        const canvas = document.getElementById('seating-canvas'); 
        if (!canvas) return;
        let html = '';
        
        (window.appState.furniture || []).forEach(f => {
            let content, extraStyle;
            if(f.type === 'teacher') { content = 'Teacher Desk'; extraStyle = 'width: 120px; height: 60px; background: #cbd5e1;'; }
            if(f.type === 'whiteboard') { content = 'Whiteboard'; extraStyle = 'width: 200px; height: 20px; background: var(--text-main); color: var(--bg-app);'; }
            
            html += `<div class="furn-item" style="position:absolute; left:${f.x}px; top:${f.y}px; ${extraStyle} border-radius:4px; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:0.75em; cursor:grab; box-shadow:var(--shadow-sm);" draggable="true" ondragstart="seatingController.dragEntity(event, '${f.id}', 'furniture')">${content}</div>`;
        });

        (window.appState.desks || []).forEach(d => {
            html += `<div class="desk-placeholder" style="left: ${d.x}px; top: ${d.y}px;" draggable="true" ondblclick="seatingController.deleteDesk('${d.id}')" title="Double-click to delete desk" ondragstart="seatingController.dragEntity(event, '${d.id}', 'desk')" ondrop="seatingController.dropOnDesk(event, '${d.id}')" ondragover="seatingController.allowDrop(event)"><i class="fas fa-arrows-alt" style="opacity:0.2;"></i></div>`;
        });
        
        (window.appState.seatingStudents || []).filter(s => s.deskId).forEach(s => {
            const desk = (window.appState.desks || []).find(d => d.id === s.deskId);
            if(!desk) return;
            let dots = '';
            if(s.sen) dots += '<div class="dot dot-sen" title="SEN"></div>';
            if(s.pp) dots += '<div class="dot dot-pp" title="Pupil Premium"></div>';
            if(s.fsm) dots += '<div class="dot dot-fsm" title="FSM"></div>';

            const heatColor = this.heatmapActive ? this.heatmapColor(s) : 'var(--accent)';
            const heatShadow = this.heatmapActive ? `box-shadow:0 0 0 2px ${heatColor}33, var(--shadow-md);` : '';
            html += `
            <div class="desk-card" id="card-${s.id}" style="left:${desk.x}px;top:${desk.y}px;border-color:${heatColor};${heatShadow}" draggable="true" ondblclick="seatingController.deleteDesk('${desk.id}')" title="Double-click to delete desk" ondragstart="seatingController.dragEntity(event, '${desk.id}', 'desk')" ondrop="seatingController.dropOnDesk(event, '${desk.id}')" ondragover="seatingController.allowDrop(event)">
                <div class="desk-name" draggable="true" ondragstart="seatingController.dragEntity(event, '${s.id}', 'student')">${window.app.escapeHTML(String(s.name || ''))}</div>
                <div style="font-size:0.75em;color:var(--text-muted);">CAT: ${window.app.escapeHTML(String(s.catMean || '-'))}</div>
                <div class="privacy-dots">${dots}</div>
            </div>`;
        });
        canvas.innerHTML = html;
        this.syncHeatmapButton();
    },

    toggleProjectorMode() {
        document.body.classList.toggle('projector-active');
        const overlay = document.getElementById('projector-overlay');
        overlay.style.display = document.body.classList.contains('projector-active') ? 'flex' : 'none';
        if (!document.body.classList.contains('projector-active')) {
            document.getElementById('pt-random').style.display = 'none';
        }
    },

    pickRandomName() {
        document.getElementById('projector-overlay').style.display = 'flex';
        document.getElementById('pt-random').style.display = 'block';
    },

    spinRandomName() {
        let pool = (window.appState.seatingStudents || []).filter(s => s.deskId);
        if(pool.length === 0) pool = window.appState.seatingStudents || []; 
        if(pool.length === 0) return window.app.showToast("No students in class!");
        
        const display = document.getElementById('random-name-display');
        document.querySelectorAll('.desk-card').forEach(c => c.classList.remove('highlight'));
        
        let counter = 0;
        const spin = setInterval(() => {
            const rand = pool[Math.floor(Math.random() * pool.length)];
            display.innerText = rand.name;
            counter++;
            if(counter > 15) {
                clearInterval(spin);
                const winner = pool[Math.floor(Math.random() * pool.length)];
                display.innerText = winner.name;
                const winnerCard = document.getElementById('card-' + winner.id);
                if(winnerCard) winnerCard.classList.add('highlight');
            }
        }, 80);
    },

    toggleNoiseMeter() {
        const overlay = document.getElementById('projector-overlay');
        overlay.style.display = 'flex';
        const meter = document.getElementById('pt-noise');
        if (!meter) return;

        if(meter.style.display === 'block') {
            meter.style.display = 'none';
            if(this.noiseStream) {
                this.noiseStream.getTracks().forEach(t => t.stop());
                this.noiseStream = null;
            }
            clearInterval(this.noiseInterval);
        } else {
            meter.style.display = 'block';
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                this.noiseStream = stream;
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                this.analyser = this.audioContext.createAnalyser();
                const source = this.audioContext.createMediaStreamSource(stream);
                source.connect(this.analyser);
                this.analyser.fftSize = 256;
                const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
                
                this.noiseInterval = setInterval(() => {
                    this.analyser.getByteFrequencyData(dataArray);
                    let sum = dataArray.reduce((a,b)=>a+b,0);
                    let avg = sum / dataArray.length;
                    const bar = document.getElementById('noise-bar');
                    if(bar) {
                        bar.style.width = Math.min(100, avg * 1.5) + '%';
                        bar.style.background = avg > 70 ? '#ef4444' : (avg > 40 ? '#f59e0b' : '#10b981');
                    }
                }, 100);
            }).catch(e => {
                window.app.showToast("Microphone access denied.");
                meter.style.display = 'none';
            });
        }
    }
};
