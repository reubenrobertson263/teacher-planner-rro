window.seatingController = {
    undoStack: [],
    audioContext: null,
    analyser: null,
    noiseStream: null,
    noiseInterval: null,
    bgAltState: false, 
    
    async init() {
        const res = await fetch('/api/classes');
        if (res.ok) window.appState.classes = await res.json();
        
        const sel = document.getElementById('seating-class-select');
        if (sel) {
            sel.innerHTML = '<option value="">Select a Class...</option>' + (window.appState.classes || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
    },

    async loadSelectedSeatingPlan() {
        const sel = document.getElementById('seating-class-select').value;
        const cls = (window.appState.classes || []).find(c => c.id === sel);
        if(!cls) return;

        try {
            const res = await fetch('/api/seating');
            if (res.ok) {
                const plans = await res.json();
                const saved = plans.find(p => p.classId === sel);
                if (saved && saved.layoutData) {
                    const data = JSON.parse(saved.layoutData);
                    window.appState.desks = data.desks || [];
                    window.appState.furniture = data.furniture || [];
                    
                    window.appState.seatingStudents = cls.students.map(s => {
                        const existing = (data.students || []).find(es => es.id === s.id);
                        return { ...s, deskId: existing ? existing.deskId : null };
                    });
                    this.undoStack = [];
                    this.renderSeatingCanvas();
                    this.renderSeatingPool();
                    return;
                }
            }
        } catch (e) { console.error("Error loading seating plan"); }

        window.appState.seatingStudents = cls.students.map(s => ({ ...s, deskId: null }));
        window.appState.desks = [];
        window.appState.furniture = [];
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
            await fetch('/api/seating', {
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

    addDesk() { 
        this.saveStateToHistory(); 
        if(!window.appState.desks) window.appState.desks = [];
        window.appState.desks.push({ id: 'desk-' + Date.now(), x: 50, y: 50 }); 
        this.renderSeatingCanvas(); 
    },

    addFurniture(type) { 
        this.saveStateToHistory(); 
        if(!window.appState.furniture) window.appState.furniture = [];
        window.appState.furniture.push({ id: 'furn-' + Date.now(), type, x: 50, y: 50 }); 
        this.renderSeatingCanvas(); 
    },

    clearDesks() {
        if(!confirm("Wipe all desks and furniture?")) return;
        this.saveStateToHistory();
        window.appState.desks = [];
        window.appState.furniture = [];
        if(window.appState.seatingStudents) window.appState.seatingStudents.forEach(s => s.deskId = null);
        this.renderSeatingCanvas();
        this.renderSeatingPool();
    },

    flipRoom() {
        this.saveStateToHistory();
        const canvas = document.getElementById('seating-canvas');
        if(!canvas) return;
        
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        
        (window.appState.desks || []).forEach(d => {
            d.x = Math.max(0, w - d.x - 110); 
            d.y = Math.max(0, h - d.y - 65);  
        });
        
        (window.appState.furniture || []).forEach(f => {
            const fw = f.type === 'whiteboard' ? 200 : 120;
            const fh = f.type === 'whiteboard' ? 20 : 60;
            f.x = Math.max(0, w - f.x - fw);
            f.y = Math.max(0, h - f.y - fh);
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
        let pool = (window.appState.seatingStudents || []).filter(s => !s.deskId);
        (window.appState.desks || []).forEach(d => {
            const occupant = window.appState.seatingStudents.find(s => s.deskId === d.id);
            if (!occupant && pool.length > 0) {
                pool[0].deskId = d.id;
                pool.shift();
            }
        });
        this.renderSeatingCanvas();
        this.renderSeatingPool();
    },

    alternateBoyGirl() {
        this.saveStateToHistory();
        this.unseatAll();
        
        let pool = window.appState.seatingStudents || [];
        let boys = pool.filter(s => s.gender && s.gender.toLowerCase().startsWith('m'));
        let girls = pool.filter(s => s.gender && s.gender.toLowerCase().startsWith('f'));
        let others = pool.filter(s => !s.gender || (!s.gender.toLowerCase().startsWith('m') && !s.gender.toLowerCase().startsWith('f')));
        
        let arranged = [];
        let max = Math.max(boys.length, girls.length);
        
        this.bgAltState = !this.bgAltState;
        
        for(let i=0; i<max; i++) {
            if(this.bgAltState) {
                if(boys[i]) arranged.push(boys[i]);
                if(girls[i]) arranged.push(girls[i]);
            } else {
                if(girls[i]) arranged.push(girls[i]);
                if(boys[i]) arranged.push(boys[i]);
            }
        }
        arranged = arranged.concat(others);
        
        (window.appState.desks || []).forEach((d, i) => {
            if (arranged[i]) arranged[i].deskId = d.id;
        });
        
        this.renderSeatingCanvas();
        this.renderSeatingPool();
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
            html += `<div style="background:var(--note-bg); border:1px solid var(--border); padding:8px 12px; border-radius:4px; font-size:0.85em; cursor:grab; font-weight:600;" draggable="true" ondragstart="seatingController.dragEntity(event, '${s.id}', 'student')">${s.name}</div>`;
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
            html += `<div class="desk-placeholder" style="left: ${d.x}px; top: ${d.y}px;" draggable="true" ondragstart="seatingController.dragEntity(event, '${d.id}', 'desk')" ondrop="seatingController.dropOnDesk(event, '${d.id}')" ondragover="seatingController.allowDrop(event)"><i class="fas fa-arrows-alt" style="opacity:0.2;"></i></div>`;
        });
        
        (window.appState.seatingStudents || []).filter(s => s.deskId).forEach(s => {
            const desk = (window.appState.desks || []).find(d => d.id === s.deskId);
            if(!desk) return;
            let dots = '';
            if(s.sen) dots += '<div class="dot dot-sen" title="SEN"></div>';
            if(s.pp) dots += '<div class="dot dot-pp" title="Pupil Premium"></div>';
            if(s.fsm) dots += '<div class="dot dot-fsm" title="FSM"></div>';

            html += `
            <div class="desk-card" id="card-${s.id}" style="left: ${desk.x}px; top: ${desk.y}px;" draggable="true" ondragstart="seatingController.dragEntity(event, '${desk.id}', 'desk')" ondrop="seatingController.dropOnDesk(event, '${desk.id}')" ondragover="seatingController.allowDrop(event)">
                <div class="desk-name" draggable="true" ondragstart="seatingController.dragEntity(event, '${s.id}', 'student')">${s.name}</div>
                <div style="font-size:0.75em; color:var(--text-muted);">CAT: ${s.catMean || '-'}</div>
                <div class="privacy-dots">${dots}</div>
            </div>`;
        });
        canvas.innerHTML = html;
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
