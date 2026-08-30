window.seatingController = {
    undoStack: [],
    redoStack: [],

    async init() {
        const res = await fetch('/api/classes');
        if (res.ok) window.appState.classes = await res.json();
        
        const sel = document.getElementById('seating-class-select');
        if (sel) {
            sel.innerHTML = '<option value="">Select a Class...</option>' + (window.appState.classes || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
    },

    loadSelectedSeatingPlan() {
        const sel = document.getElementById('seating-class-select').value;
        const cls = (window.appState.classes || []).find(c => c.id === sel);
        if(!cls) return;

        window.appState.seatingStudents = cls.students.map(s => ({ ...s, deskId: null }));
        window.appState.desks = [];
        window.appState.furniture = [];
        this.renderSeatingCanvas();
        this.renderSeatingPool();
    },

    saveStateToHistory() {
        const state = {
            desks: JSON.parse(JSON.stringify(window.appState.desks)),
            furniture: JSON.parse(JSON.stringify(window.appState.furniture || [])),
            seatingStudents: JSON.parse(JSON.stringify(window.appState.seatingStudents))
        };
        this.undoStack.push(state);
        if(this.undoStack.length > 30) this.undoStack.shift();
        this.redoStack = [];
    },

    addEmptyDesk() { 
        this.saveStateToHistory(); 
        window.appState.desks.push({ id: 'desk-' + Date.now(), x: 50, y: 50 }); 
        this.renderSeatingCanvas(); 
    },

    addFurniture(type) { 
        this.saveStateToHistory(); 
        window.appState.furniture.push({ id: 'furn-' + Date.now(), type, x: 50, y: 50 }); 
        this.renderSeatingCanvas(); 
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
        ev.target.style.borderColor = 'var(--accent)';
        const type = ev.dataTransfer.getData("type"); 
        const id = ev.dataTransfer.getData("id");
        
        if (type === 'student') {
            this.saveStateToHistory();
            const student = window.appState.seatingStudents.find(s => s.id === id);
            if(student) {
                const occupant = window.appState.seatingStudents.find(s => s.deskId === deskId);
                if(occupant) occupant.deskId = null;
                
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
        const offsetX = parseInt(ev.dataTransfer.getData("offsetX")) || 70;
        const offsetY = parseInt(ev.dataTransfer.getData("offsetY")) || 47;
        
        if (type === 'desk') {
            this.saveStateToHistory();
            const desk = window.appState.desks.find(d => d.id === id);
            if(desk) {
                desk.x = Math.max(0, ev.clientX - rect.left - offsetX);
                desk.y = Math.max(0, ev.clientY - rect.top - offsetY);
                this.renderSeatingCanvas();
            }
        } else if (type === 'furniture') {
            this.saveStateToHistory();
            const furn = window.appState.furniture.find(f => f.id === id);
            if(furn) {
                furn.x = Math.max(0, ev.clientX - rect.left - offsetX);
                furn.y = Math.max(0, ev.clientY - rect.top - offsetY);
                this.renderSeatingCanvas();
            }
        } else if (type === 'student') {
            this.saveStateToHistory();
            const student = window.appState.seatingStudents.find(s => s.id === id); 
            if(student) { 
                student.deskId = null; 
                this.renderSeatingCanvas(); 
                this.renderSeatingPool(); 
            } 
        }
    },

    renderSeatingPool() {
        const pool = document.getElementById('unassigned-pool');
        if(!pool) return;
        let html = '';
        (window.appState.seatingStudents || []).filter(s => !s.deskId).forEach(s => {
            html += `<div style="background:var(--note-bg); border:1px solid var(--border); padding:8px; border-radius:4px; font-size:0.85em; cursor:grab; font-weight:600;" draggable="true" ondragstart="seatingController.dragEntity(event, '${s.id}', 'student')">${s.name}</div>`;
        });
        pool.innerHTML = html;
    },

    renderSeatingCanvas() {
        const canvas = document.getElementById('seating-canvas'); 
        if (!canvas) return;
        let html = '';
        
        (window.appState.furniture || []).forEach(f => {
            let content = f.type === 'teacher' ? 'Teacher Desk' : 'Whiteboard / Projector';
            let extraStyle = f.type === 'whiteboard' ? 'width: 200px; height: 20px; background: var(--border); border-radius:4px;' : 'width: 120px; height: 60px; background: #cbd5e1; border-radius:8px;';
            html += `<div style="position:absolute; left:${f.x}px; top:${f.y}px; ${extraStyle} border:2px solid var(--text-muted); display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:0.75em; color:var(--text-main); cursor:grab; box-shadow:var(--shadow-sm);" draggable="true" ondragstart="seatingController.dragEntity(event, '${f.id}', 'furniture')">${content}</div>`;
        });

        window.appState.desks.forEach(d => {
            html += `<div class="desk-placeholder" style="left: ${d.x}px; top: ${d.y}px;" draggable="true" ondragstart="seatingController.dragEntity(event, '${d.id}', 'desk')" ondrop="seatingController.dropOnDesk(event, '${d.id}')" ondragover="seatingController.allowDrop(event)"><i class="fas fa-arrows-alt" style="opacity:0.2;"></i></div>`;
        });
        
        window.appState.seatingStudents.filter(s => s.deskId).forEach(s => {
            const desk = window.appState.desks.find(d => d.id === s.deskId);
            if(!desk) return;
            let dots = '';
            if(s.sen) dots += '<div class="dot dot-sen" title="SEN"></div>';
            if(s.pp) dots += '<div class="dot dot-pp" title="Pupil Premium"></div>';
            if(s.fsm) dots += '<div class="dot dot-fsm" title="FSM"></div>';

            html += `
            <div class="desk-card" style="left: ${desk.x}px; top: ${desk.y}px;" draggable="true" ondragstart="seatingController.dragEntity(event, '${desk.id}', 'desk')" ondrop="seatingController.dropOnDesk(event, '${desk.id}')" ondragover="seatingController.allowDrop(event)">
                <div class="desk-name" draggable="true" ondragstart="seatingController.dragEntity(event, '${s.id}', 'student')">${s.name}</div>
                <div style="font-size:0.75em; color:var(--text-muted);">CAT: ${s.catMean || '-'}</div>
                <div class="privacy-dots">${dots}</div>
            </div>`;
        });
        canvas.innerHTML = html;
    }
};
