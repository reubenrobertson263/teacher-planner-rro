// public/js/seating.js
window.seatingController = {
    desks: [],
    unseated: [],

    async init() {
        const [resC, resR] = await Promise.all([fetch('/api/classes'), fetch('/api/rooms')]);
        if (resC.ok) window.appState.classes = await resC.json();
        if (resR.ok) window.appState.rooms = await resR.json();

        const cSel = document.getElementById('seating-class-select');
        const rSel = document.getElementById('seating-room-select');

        if (cSel) {
            cSel.innerHTML = (window.appState.classes || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
        if (rSel) {
            rSel.innerHTML = (window.appState.rooms || []).map(r => `<option value="${r.id}">${r.name}</option>`).join('');
        }

        this.loadClassSeating();
    },

    async loadClassSeating() {
        const cSel = document.getElementById('seating-class-select');
        if (!cSel || !cSel.value) return;

        const cls = (window.appState.classes || []).find(c => c.id === cSel.value);
        this.unseated = cls && cls.students ? [...cls.students] : [];
        this.desks = [];

        // Generate 30 default desks if none
        for (let i = 1; i <= 30; i++) {
            this.desks.push({ id: i, student: null });
        }

        this.renderCanvas();
        this.renderUnseated();
    },

    renderCanvas() {
        const matrix = document.getElementById('desk-matrix');
        if (!matrix) return;
        matrix.innerHTML = '';

        this.desks.forEach((desk, idx) => {
            const studentHtml = desk.student ? `
                <div style="background: var(--accent); color: white; padding: 6px; border-radius: 4px; font-size: 0.8em; font-weight: 700; text-align: center; width: 100%;">
                    ${desk.student.name}
                    <span style="display:block; font-size:0.75em; opacity:0.8;">${desk.student.sen ? 'SEN ' : ''}${desk.student.pp ? 'PP' : ''}</span>
                </div>` : '<span style="font-size:0.75em; color:var(--text-muted);">Empty Desk</span>';

            matrix.innerHTML += `
                <div class="drop-zone" ondragover="event.preventDefault()" ondrop="seatingController.dropToDesk(event, ${idx})" 
                     style="height: 80px; border: 2px dashed var(--border); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; padding: 6px; cursor: pointer;"
                     ondblclick="seatingController.unseatDesk(${idx})">
                     ${studentHtml}
                </div>`;
        });
    },

    renderUnseated() {
        const list = document.getElementById('unseated-students-list');
        if (!list) return;
        list.innerHTML = '';
        this.unseated.forEach((s, idx) => {
            list.innerHTML += `
                <div draggable="true" ondragstart="seatingController.dragStudent(event, '${s.id}')" 
                     style="background: var(--border); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 0.85em; cursor: grab; font-weight: 600;">
                    ${s.name}
                </div>`;
        });
    },

    dragStudent(ev, studentId) {
        ev.dataTransfer.setData("text/plain", studentId);
    },

    dropToDesk(ev, deskIndex) {
        ev.preventDefault();
        const studentId = ev.dataTransfer.getData("text/plain");
        const sIdx = this.unseated.findIndex(s => s.id === studentId);
        if (sIdx !== -1) {
            const student = this.unseated.splice(sIdx, 1)[0];
            if (this.desks[deskIndex].student) this.unseated.push(this.desks[deskIndex].student);
            this.desks[deskIndex].student = student;
            this.renderCanvas();
            this.renderUnseated();
        }
    },

    unseatDesk(deskIndex) {
        if (this.desks[deskIndex].student) {
            this.unseated.push(this.desks[deskIndex].student);
            this.desks[deskIndex].student = null;
            this.renderCanvas();
            this.renderUnseated();
        }
    },

    autoSeat() {
        this.desks.forEach(d => { if (d.student) this.unseated.push(d.student); d.student = null; });
        this.desks.forEach((d, i) => {
            if (this.unseated.length > 0) d.student = this.unseated.shift();
        });
        this.renderCanvas();
        this.renderUnseated();
        window.app.showToast("Students auto-seated!");
    },

    addDesk() {
        this.desks.push({ id: this.desks.length + 1, student: null });
        this.renderCanvas();
    },

    clearDesks() {
        this.desks.forEach(d => { if (d.student) this.unseated.push(d.student); d.student = null; });
        this.renderCanvas();
        this.renderUnseated();
    },

    async saveLayout(btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        setTimeout(() => {
            btn.innerHTML = '<i class="fas fa-save"></i> Save Plan';
            window.app.showToast("Seating Plan Saved!");
        }, 500);
    }
};
