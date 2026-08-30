window.dashboardController = {
    currentDate: new Date(),

    async init() {
        this.renderSkeleton();
        await this.loadData();
    },

    navigateDate(dir) {
        this.currentDate.setDate(this.currentDate.getDate() + dir);
        this.renderSkeleton();
        this.renderTodayView();
    },

    renderSkeleton() {
        const container = document.getElementById('today-timeline-container');
        if (container) {
            container.innerHTML = '<div style="text-align:center; padding: 40px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Loading schedule...</div>';
        }
    },

    getSchoolDateString(d) { 
        if(!d || isNaN(d.getTime())) d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; 
    },

    calculateWeekType(targetDate) {
        try {
            if (!window.termStart || !window.holidays) return 'A';
            const dateStr = this.getSchoolDateString(targetDate); 
            if (window.holidays.includes(dateStr) || targetDate < window.termStart) return "HOLIDAY";
            let activeWeeks = 0, d = new Date(window.termStart), checkMonday = new Date(targetDate); 
            checkMonday.setDate(targetDate.getDate() - (targetDate.getDay() === 0 ? 6 : targetDate.getDay() - 1));
            while (d <= checkMonday) { if (!window.holidays.includes(this.getSchoolDateString(d))) activeWeeks++; d.setDate(d.getDate() + 7); }
            return activeWeeks % 2 === 1 ? 'A' : 'B';
        } catch(e) {
            return 'A'; 
        }
    },

    async loadData() {
        try {
            const [uRes, pRes, tRes] = await Promise.all([
                fetch('/api/user/me').catch(()=>null),
                fetch('/api/periods').catch(()=>null),
                fetch('/api/timetable').catch(()=>null)
            ]);

            if (uRes && uRes.ok) {
                const uData = await uRes.json();
                const hoursEl = document.getElementById('dash-hours-saved');
                if (hoursEl) hoursEl.innerText = uData.hoursSaved || 0;
            }

            if (pRes && pRes.ok) window.appState.rawPeriods = await pRes.json();
            if (tRes && tRes.ok) window.appState.blocks = await tRes.json();

            this.renderTodayView();
        } catch (e) {
            console.error(e);
        }
    },

    async renderTodayView() {
        const todayTimeline = document.getElementById('today-timeline-container');
        if(!todayTimeline) return;
        
        const todayStr = this.getSchoolDateString(this.currentDate); 
        const dayOfWeek = this.currentDate.getDay();

        const headerTitle = document.getElementById('today-header-title');
        if (headerTitle) {
            const options = { weekday: 'long', month: 'short', day: 'numeric' };
            headerTitle.innerHTML = `Dashboard <span style="font-size:0.6em; color:var(--text-muted); font-weight:normal; margin-left:10px;">${this.currentDate.toLocaleDateString('en-GB', options)}</span>`;
        }
        
        if (dayOfWeek < 1 || dayOfWeek > 5) { 
            todayTimeline.innerHTML = '<div style="text-align:center; padding: 40px; background: var(--card); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm);"><h2 style="margin:0;">Weekend</h2><p style="color:var(--text-muted);">Use the arrows above to view next week.</p></div>'; 
            return; 
        }
        
        const wType = this.calculateWeekType(this.currentDate); 
        let html = '';
        let hasLessons = false;
        const periods = window.appState.rawPeriods || [];
        
        for (const p of periods) {
            if (p.isBreak) continue;
            
            const block = (window.appState.blocks || []).find(b => b.dayOfWeek === dayOfWeek && String(b.period) === String(p.id) && b.weekType === wType);
            if (!block) continue;
            
            const className = (block.entryType === 'CLASS' && block.class ? block.class.name : block.label);
            const content = await window.idb.get(`lesson_${todayStr}_${p.id}`) || '<span style="color:#9ca3af;">No plans recorded yet.</span>';
            const colorHex = (block.entryType === 'CLASS' && block.class && block.class.colorHex) ? block.class.colorHex : 'var(--border)';
            
            html += `<div style="padding:16px; border-left:6px solid ${colorHex}; background:var(--card); border-radius:var(--radius-sm); margin-bottom:12px; box-shadow:var(--shadow-sm);">
                        <div style="font-weight: 700; color: var(--text-main); margin-bottom: 8px; display:flex; justify-content:space-between;">
                            <span>${className}</span>
                            <span style="font-size:0.85em; color:var(--text-muted); font-weight:500;">${p.startTime} - ${p.endTime}</span>
                        </div>
                        <div style="font-size: 0.95em; color: var(--text-muted); line-height: 1.5;">${content}</div>
                     </div>`;
            hasLessons = true;
        }
        
        if(!hasLessons) {
            todayTimeline.innerHTML = '<div style="text-align:center; padding: 40px; background: var(--card); border-radius: var(--radius-lg); color:var(--text-muted); box-shadow: var(--shadow-sm);"><i class="fas fa-calendar-times fa-2x" style="margin-bottom:10px; opacity:0.5;"></i><br>No classes pinned to the timetable for this day.</div>';
        } else {
            todayTimeline.innerHTML = html;
        }
    }
};
