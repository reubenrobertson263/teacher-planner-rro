bindEditors() {
    document.querySelectorAll('.flowline-editor').forEach(editor => {
      editor.addEventListener('input', () => this.queueLessonSave(editor));
      editor.addEventListener('blur', () => this.saveLessonNow(editor));
      
      editor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          this.openLinkModal(editor);
        }
      });

      // FIX: Single click opens the link instantly. Bypasses edit screen entirely.
      editor.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link) {
          e.preventDefault();
          window.open(link.href, '_blank', 'noopener,noreferrer');
        }
      });

      const card = editor.closest('.flowline-card');
      card?.querySelector('[data-action="skeleton"]')?.addEventListener('click', () => this.insertSkeleton(editor));
      card?.querySelector('[data-action="format-h1"]')?.addEventListener('click', () => document.execCommand('formatBlock', false, '<h1>'));
      card?.querySelector('[data-action="format-h2"]')?.addEventListener('click', () => document.execCommand('formatBlock', false, '<h2>'));
      card?.querySelector('[data-action="bold"]')?.addEventListener('click', () => document.execCommand('bold', false, null));
      card?.querySelector('[data-action="italic"]')?.addEventListener('click', () => document.execCommand('italic', false, null));
      card?.querySelector('[data-action="underline"]')?.addEventListener('click', () => document.execCommand('underline', false, null));
      card?.querySelector('[data-action="strike"]')?.addEventListener('click', () => document.execCommand('strikethrough', false, null));
      card?.querySelector('[data-action="ul"]')?.addEventListener('click', () => document.execCommand('insertUnorderedList', false, null));
      card?.querySelector('[data-action="ol"]')?.addEventListener('click', () => document.execCommand('insertOrderedList', false, null));
      card?.querySelector('[data-action="checklist"]')?.addEventListener('click', () => this.insertChecklist(editor));
      
      const linkButton = card?.querySelector('[data-action="link"]');
      linkButton?.addEventListener('mousedown', event => event.preventDefault());
      linkButton?.addEventListener('click', () => this.openLinkModal(editor));

      card?.querySelector('[data-action="table"]')?.addEventListener('click', () => this.insertTable(editor));
      card?.querySelector('[data-action="teams"]')?.addEventListener('click', () => this.insertTeamsLink(editor));
      card?.querySelector('[data-action="ai"]')?.addEventListener('click', () => this.aiExpand(editor));
      card?.querySelector('[data-action="bump"]')?.addEventListener('click', () => this.bumpLesson(editor));
    });
    document.querySelectorAll('[data-note-date]').forEach(note => {
      note.addEventListener('input', () => this.queueNoteSave(note));
      note.addEventListener('blur', () => this.saveNoteNow(note));
    });
  },

  // FIX: Auto-detects if your cursor is inside a link so you can edit it via the toolbar button
  openLinkModal(editor) {
    const selection = window.getSelection();
    let savedRange = null;
    let existingLink = null;

    if (selection?.rangeCount) {
      const candidate = selection.getRangeAt(0);
      if (editor.contains(candidate.commonAncestorContainer)) {
        savedRange = candidate.cloneRange();
        // Check if the cursor is resting inside an existing link
        let node = candidate.commonAncestorContainer;
        if (node.nodeType === 3) node = node.parentNode; // Get parent if text node
        existingLink = node.closest('a');
      }
    }

    const currentUrl = existingLink ? existingLink.getAttribute('href') : '';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);';
    
    overlay.innerHTML = `
      <div style="background:var(--card);padding:22px;border-radius:14px;box-shadow:var(--shadow-md);width:340px;display:flex;flex-direction:column;gap:14px;border:1px solid var(--border);">
          <strong style="color:var(--text);font-size:1.1rem;"><i class="fas fa-link" style="color:var(--accent);margin-right:6px;"></i> ${existingLink ? 'Edit Link URL' : 'Insert Link'}</strong>
          <input type="url" id="custom-link-input" value="${currentUrl}" placeholder="https://..." style="padding:10px;border:2px solid var(--border);border-radius:8px;width:100%;outline:none;font-family:inherit;">
          
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px;">
              <button type="button" id="custom-link-cancel" style="padding:8px 14px;border:0;background:transparent;cursor:pointer;color:var(--text-muted);font-weight:600;">Cancel</button>
              <button type="button" id="custom-link-save" style="padding:8px 14px;border:0;background:var(--accent);color:#fff;border-radius:8px;cursor:pointer;font-weight:600;">Save</button>
          </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const input = document.getElementById('custom-link-input');
    input.focus();

    const cleanup = () => document.body.removeChild(overlay);
    
    const applyLink = () => {
      let url = input.value.trim();
      
      // If URL is cleared, remove the link wrapper but keep the text
      if (!url) {
          if (existingLink) {
              const textNode = document.createTextNode(existingLink.textContent);
              existingLink.parentNode.replaceChild(textNode, existingLink);
              editor.dispatchEvent(new Event('input', { bubbles: true }));
          }
          cleanup();
          return;
      }

      if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
      try { new URL(url); } catch (_) { return window.app.showToast('Please enter a valid URL.', 'error'); }

      cleanup();
      editor.focus();

      // If editing an existing link, just update the href
      if (existingLink) {
          existingLink.href = url;
          existingLink.setAttribute('href', url);
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          return;
      }

      // If creating a new link
      const liveSelection = window.getSelection();
      if (savedRange) {
        liveSelection.removeAllRanges();
        liveSelection.addRange(savedRange);
      }

      let range = liveSelection?.rangeCount ? liveSelection.getRangeAt(0) : null;
      if (!range || !editor.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        liveSelection.removeAllRanges();
        liveSelection.addRange(range);
      }
      if (range.collapsed) {
        const textNode = document.createTextNode(url);
        range.insertNode(textNode);
        const textRange = document.createRange();
        textRange.selectNodeContents(textNode);
        liveSelection.removeAllRanges();
        liveSelection.addRange(textRange);
      }

      document.execCommand('createLink', false, url);
      editor.querySelectorAll('a').forEach(anchor => {
        if (anchor.href === url || anchor.getAttribute('href') === url) {
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          anchor.style.textDecoration = 'underline'; 
          anchor.style.color = 'var(--accent)';
        }
      });
      liveSelection.collapseToEnd();
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    };

    document.getElementById('custom-link-cancel').addEventListener('click', cleanup);
    document.getElementById('custom-link-save').addEventListener('click', applyLink);
    input.addEventListener('keydown', (e) => { 
      if (e.key === 'Enter') applyLink(); 
      if (e.key === 'Escape') cleanup(); 
    });
  },
