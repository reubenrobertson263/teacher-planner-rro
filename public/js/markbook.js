// public/js/markbook.js
window.markbookController = {
    assessments: [],

    async init() {
        const res = await fetch('/api/classes');
        if (res.ok) window.appState.classes = await res.json();
        
        const sel = document.getElementById('markbook-class-select');
        if (sel) {
            sel.innerHTML = (window.appState.classes || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
        this.loadClassMarks();
    },

    async loadClassMarks() {
        const sel = document.getElementById('markbook-class-select');
        if (!sel || !sel.value) return;

        const res = await fetch(`/api/markbook/${sel.value}`);
        if (res.ok) this.assessments = await res.json();

        this.renderTable();
    },

    renderTable() {
        const sel = document.getElementById('markbook-class-select');
        const cls = (window.appState.classes || []).find(c => c.id === sel.value);
        const students = cls && cls.students ? cls.students : [];
        const table = document.getElementById('markbook-table');
        if (!table) return;

        let html = `<thead><tr style="background: var(--note-bg); border-bottom: 2px solid var(--border);">
            <th style="padding: 12px 16px;">Student Name</th>
            <th style="padding: 12px 16px;">Target</th>
            ${this.assessments.map(a => `<th style="padding: 12px 16px;">${a.title}</th>`).join('')}
        </tr></thead><tbody>`;

        students.forEach(s => {
            html += `<tr style="border-bottom: 1px solid var(--border);">
                <td style="padding: 12px 16px; font-weight: 600;">${s.name} ${s.sen ? '<span style="color:#8b5cf6; font-size:0.8em;">(SEN)</span>' : ''}</td>
                <td style="padding: 12px 16px; color: var(--text-muted);">${s.targetGrade || '-'}</td>
                ${this.assessments.map(a => {
                    const grade = a.grades.find(g => g.studentId === s.id);
                    return `<td style="padding: 6px 16px;">
                        <input type="text" class="form-control" style="width: 70px; padding: 4px 8px; text-align: center;" 
                               value="${grade ? grade.value : ''}" 
                               onchange="markbookController.saveGrade('${s.id}', '${a.id}', this.value)">
                    </td>`;
                }).join('')}
            </tr>`;
        });

        html += `</tbody>`;
        table.innerHTML = html;
    },

    async addAssessment() {
        const title = prompt("Enter assessment name (e.g. Autumn Exam):");
        if (!title) return;
        const sel = document.getElementById('markbook-class-select');
        
        await fetch(`/api/markbook/${sel.value}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, date: new Date(), grades: [] })
        });
        window.app.showToast("Assessment added");
        this.loadClassMarks();
    },

    async saveGrade(studentId, assessmentId, value) {
        await fetch('/api/markbook/grade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId, assessmentId, value })
        });
        window.app.showToast("Grade updated");
    }
};
