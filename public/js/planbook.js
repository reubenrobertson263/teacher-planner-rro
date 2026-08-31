window.planbookController = {
    currentDate: new Date(),
    viewMode: 'week',
    blocks: [],
    classes: [],
    periods: [],

    async init() {
        await this.loadData();
        this.setView('week');
    },

    async loadData() {
        try {
            const [resP, resC, resT] = await Promise.all([
                fetch('/api/periods'), fetch('/api/classes'), fetch('/api/timetable')
            ]);
            if(resP.ok) this.periods = await resP.json();
            if(resC.ok) this.classes = await resC.json();
            if(resT.ok) this.blocks = await resT.json();
        } catch(e) { console.error(e); }
    },

    setView(mode) {
        this.viewMode = mode;
        document.getElementById('btn-view-day').classList.toggle('active', mode === 'day');
        document.getElementById('btn-view-week').classList.toggle('active', mode === 'week');
        this.render();
    },

    navigate(dir) {
        if(this.viewMode === 'day') {
            this.currentDate.setDate(this.currentDate.getDate() + dir);
        } else {
            this.currentDate.setDate(this.currentDate.getDate() + (dir * 7));
        }
        this.render();
    },

    render() {
        if(this.viewMode === 'day') this.renderDayView();
        else this.renderWeekView();
    },

    getWeekType() { return 'A'; }, // Simplification for V1

    renderDayView() {
        const options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
        document.getElementById('pb-date-display').innerHTML = `<i class="far fa-calendar"></i> ${this.currentDate.toLocaleDateString('en-US', options)}`;
        
        const dayOfWeek = this.currentDate.getDay();
        if(dayOfWeek === 0 || dayOfWeek === 6) {
            document.getElementById('pb-view-container').innerHTML = `<div class="pb-empty-state"><h3>Weekend</h3><p>Enjoy your time off.</p></div>`;
            return;
        }

        const dayBlocks = this.blocks.filter(b => b.dayOfWeek === dayOfWeek && b.weekType === this.getWeekType());
        
        let mainHtml = '';
        if(dayBlocks.length === 0) {
            mainHtml = `<div class="pb-empty-state"><h3>No Classes Today</h3><p>Schedule classes on the timetable.</p></div>`;
        } else {
            this.periods.forEach(p => {
                const block = dayBlocks.find(b => String(b.period) === String(p.id || p.sortOrder));
                if(block && !p.isBreak) {
                    const cls = block.entryType === 'CLASS' ? this.classes.find(c => c.id === block.classId) : null;
                    const title = cls ? cls.name : block.label;
                    mainHtml += `
                    <div class="pb-chalk-card">
                        <div class="pb-chalk-header">
                            <div>
                                <div class="pb-chalk-title">${title}</div>
                                <div class="pb-chalk-time">${p.startTime} - ${p.endTime}</div>
                            </div>
                            <div><i class="fas fa-cog" style="cursor:pointer; opacity:0.8;"></i></div>
                        </div>
                        <div class="pb-chalk-controls">
                            <span style="font-size:0.8em; font-weight:700; color:var(--text-muted); background:var(--border); padding:4px 8px; border-radius:4px;">Unit +</span>
                            <span style="font-size:0.85em; color:var(--text-muted); margin-left:8px;">Untitled Lesson</span>
                        </div>
                        <div class="pb-chalk-body" contenteditable="true" placeholder="Start typing your lesson plan..."></div>
                    </div>`;
                }
            });
        }

        document.getElementById('pb-view-container').innerHTML = `
            <div class="pb-day-layout">
                <div class="pb-day-main">${mainHtml}</div>
                <div class="pb-day-side">
                    <div class="pb-yellow-note" contenteditable="true" placeholder="Type a note..."></div>
                    <div style="background:var(--card); border:1px solid var(--border); border-radius:var(--radius-sm); padding:16px;">
                        <h4 style="margin:0 0 10px 0; text-align:center;">${this.currentDate.toLocaleString('default', { month: 'long' })}</h4>
                        <div style="text-align:center; color:var(--text-muted); font-size:0.9em;">Calendar Widget Space</div>
                    </div>
                </div>
            </div>`;
    },

    renderWeekView() {
        const startOfWeek = new Date(this.currentDate);
        startOfWeek.setDate(this.currentDate.getDate() - this.currentDate.getDay() + 1); // Monday
        
        document.getElementById('pb-date-display').innerHTML = `<i class="far fa-calendar"></i> Week of ${startOfWeek.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

        let html = '<div class="pb-week-grid">';
        
        for(let i=1; i<=5; i++) {
            const colDate = new Date(startOfWeek);
            colDate.setDate(startOfWeek.getDate() + (i - 1));
            
            const dayBlocks = this.blocks.filter(b => b.dayOfWeek === i && b.weekType === this.getWeekType());
            
            html += `<div class="pb-day-col">
                <div class="pb-day-header">
                    <span>Day ${this.getWeekType()} | <b>${colDate.toLocaleDateString('en-US', {weekday:'short'})} (${colDate.toLocaleDateString('en-US', {month:'short', day:'numeric'})})</b></span>
                    <i class="fas fa-chevron-down" style="color:var(--border); background:var(--card); padding:4px; border-radius:50%;"></i>
                </div>
                <div class="pb-yellow-note" contenteditable="true" placeholder="Type a note..."></div>`;
                
            if(dayBlocks.length === 0) {
                html += `<div class="pb-empty-state" style="border:none; background:transparent;"><h3>No Classes Today</h3><p style="font-size:0.85em;">Schedule classes on the timetable</p></div>`;
            } else {
                this.periods.forEach(p => {
                    const block = dayBlocks.find(b => String(b.period) === String(p.id || p.sortOrder));
                    if(block && !p.isBreak) {
                        const cls = block.entryType === 'CLASS' ? this.classes.find(c => c.id === block.classId) : null;
                        const title = cls ? cls.name : block.label;
                        html += `
                        <div class="pb-chalk-card" style="min-height: 180px;">
                            <div class="pb-chalk-header" style="padding: 8px 12px;">
                                <div>
                                    <div class="pb-chalk-title" style="font-size:0.85em;">${title}</div>
                                    <div class="pb-chalk-time" style="font-size:0.7em;">${p.startTime} - ${p.endTime}</div>
                                </div>
                                <div><i class="fas fa-cog" style="cursor:pointer; opacity:0.8; font-size:0.8em;"></i></div>
                            </div>
                            <div class="pb-chalk-controls" style="padding: 4px 8px;">
                                <span style="font-size:0.7em; font-weight:700; color:var(--text-muted); background:var(--border); padding:2px 6px; border-radius:4px;">Unit +</span>
                            </div>
                            <div class="pb-chalk-body" style="padding:8px; font-size:0.85em;" contenteditable="true"></div>
                        </div>`;
                    }
                });
            }
            html += `</div>`;
        }
        html += '</div>';
        document.getElementById('pb-view-container').innerHTML = html;
    }
};
