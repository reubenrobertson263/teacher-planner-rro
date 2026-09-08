window.dashboardController = {
    currentDate: new Date(),

    async init() {
        this.renderSkeleton();
        await this.loadData();
    },

    navigateDate(dir) {
        this.currentDate = new Date(this.currentDate);
        this.currentDate.setDate(this.currentDate.getDate() + Number(dir));
        this.renderTodayView();
    },

    renderSkeleton() {
        const container = document.getElementById('today-timeline-container');
        if (container) {
            container.innerHTML = '<div class="dash-empty"><i class="fas fa-spinner fa-spin fa-2x"></i><span>Loading schedule…</span></div>';
        }
    },

    getSchoolDateString(d) {
        if (!d || Number.isNaN(d.getTime())) d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },

    getWeekType(date) {
        // Planbook owns the A/B cycle calculation. Reuse that exact implementation so
        // Dashboard and Planbook can never disagree about the current week.
        if (window.planbookController?.getWeekType) return window.planbookController.getWeekType(date);
        return 'A';
    },

    async loadData() {
        try {
            const uRes = await fetch('/api/user/me', { cache: 'no-store' }).catch(() => null);
            if (uRes?.ok) {
                const uData = await uRes.json();
                const hoursEl = document.getElementById('dash-hours-saved');
                if (hoursEl) hoursEl.innerText = uData.hoursSaved || 0;
            }
        } catch (error) {
            console.error(error);
        }
        this.renderTodayView();
    },

    classForBlock(block) {
        if (!block || block.entryType !== 'CLASS') return null;
        return (window.appState.classes || []).find(cls => cls.id === block.classId) || block.class || null;
    },

    renderTodayView() {
        const timeline = document.getElementById('today-timeline-container');
        if (!timeline) return;

        const date = new Date(this.currentDate);
        const dayOfWeek = date.getDay();
        const dateKey = this.getSchoolDateString(date);
        const weekType = this.getWeekType(date);
        const esc = window.app.escapeHTML;

        const headerTitle = document.getElementById('today-header-title');
        if (headerTitle) {
            headerTitle.innerHTML = `Dashboard <span class="dash-date-subtitle">${esc(date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }))}</span>`;
        }
        const weekBadge = document.getElementById('dashboard-week-badge');
        if (weekBadge) weekBadge.innerHTML = `<span>Week</span><strong>${esc(weekType)}</strong>`;

        if (dayOfWeek < 1 || dayOfWeek > 5) {
            timeline.innerHTML = '<div class="dash-empty"><i class="fas fa-mug-hot fa-2x"></i><strong>Weekend</strong><span>Use the arrows to look ahead to a teaching day.</span></div>';
            return;
        }

        const periods = (window.appState.rawPeriods || []).slice().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
        const classBlocks = (window.appState.blocks || [])
            .filter(block => block.entryType === 'CLASS' && Number(block.dayOfWeek) === dayOfWeek && block.weekType === weekType)
            .sort((a, b) => Number(a.period) - Number(b.period));

        if (!classBlocks.length) {
            timeline.innerHTML = '<div class="dash-empty"><i class="fas fa-calendar-times fa-2x"></i><strong>No classes today</strong><span>Pin classes in Timetable Builder and they will appear here automatically.</span></div>';
            return;
        }

        const periodByNumber = new Map(periods.map((period, index) => [Number(period.sortOrder || (index + 1)), period]));
        timeline.innerHTML = classBlocks.map(block => {
            const period = periodByNumber.get(Number(block.period)) || {};
            const cls = this.classForBlock(block);
            const className = cls?.name || 'Class';
            const colour = cls?.colorHex || '#3b82f6';
            const room = cls?.room || block.room || '';
            const time = [period.startTime, period.endTime].filter(Boolean).join(' – ');
            const periodLabel = period.label || `P${block.period}`;
            return `<article class="dash-lesson-card" style="--lesson-colour:${esc(colour)}">
                <div class="dash-period-badge"><strong>${esc(periodLabel)}</strong><span>${esc(time)}</span></div>
                <div class="dash-lesson-main">
                    <div class="dash-lesson-top"><h3>${esc(className)}</h3>${room ? `<span><i class="fas fa-location-dot"></i> ${esc(room)}</span>` : ''}</div>
                    <div class="dash-lesson-meta"><span><i class="fas fa-calendar-day"></i> ${esc(dateKey)}</span><span><i class="fas fa-layer-group"></i> Week ${esc(weekType)}</span></div>
                </div>
            </article>`;
        }).join('');
    }
};
