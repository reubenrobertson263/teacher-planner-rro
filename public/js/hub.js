'use strict';
window.hub = {
  sections: ['Home', 'Data Hub', 'Pastoral', 'Teaching', 'Personal'],
  cards: [], section: 'Home', db: null, userId: null,
  defaults() {
    const groups = {
      Home: ['Daily bulletin', 'INSET information', 'School calendar'],
      'Data Hub': ['Pupil tracker'],
      Pastoral: ['SEND register', 'Duty rota', 'Isolation bookings', 'Progress time resources', 'SMSC grid', 'Proud at BCHS', 'PSHE resources', 'PM / HOY day to day', 'Closing the loop – HT1', 'Closing the loop – HT2', 'Progress time timetable', 'CALM documentation', 'Year group timetable', 'Year information and key individuals', 'Pastoral structure', 'Detention tasks', 'Detention and uniform rota', 'Resolve bookings'],
      Teaching: ['My teaching resources', 'Department resources', 'Digital technology resources', 'Enterprise resources', 'School dates', 'R068 exemplars', 'R069 exemplars', 'R069 coursework checklist', 'Enterprise data entry', 'Coursework intervention tracker', 'R068 coursework checklist'],
      Personal: ['Training links', 'Tes development', 'HR portal', 'Microsoft To Do', 'Personal calendar']
    };
    return Object.entries(groups).flatMap(([section,titles]) => titles.map((title,i) => ({id: `${section}-${i}`, section, title, url:'', note:'Add the current link.', pinned:section === 'Home'})));
  },
  safeUrl(value) {
    if (!String(value || '').trim()) return '';
    const url = new URL(String(value).trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a web address beginning with https:// or http://, without a password.');
    return url.href;
  },
  validateCards(cards) {
    if (!Array.isArray(cards) || cards.length > 500) throw new Error('Choose a Hub backup containing up to 500 resources.');
    const ids = new Set();
    return cards.map(card => {
      if (!card || typeof card.id !== 'string' || ids.has(card.id) || !this.sections.includes(card.section) || typeof card.title !== 'string' || !card.title.trim() || card.title.length > 160 || typeof card.url !== 'string' || card.url.length > 2000 || typeof card.note !== 'string' || card.note.length > 1000) throw new Error('This backup contains an invalid resource.');
      ids.add(card.id);
      return {id:card.id, section:card.section, title:card.title.trim(), url:this.safeUrl(card.url), note:card.note, pinned:!!card.pinned};
    });
  },
  async checkSession() {
    const response = await fetch('/api/user/me', {cache:'no-store',credentials:'same-origin'});
    if (!response.ok) throw new Error('Please sign in to FlowDesk to open your Hub.');
    const user = await response.json();
    if (!user.id || (this.userId && this.userId !== user.id)) throw new Error('Your account changed. Reload the Hub to continue.');
    return user;
  },
  async read() {
    return new Promise((resolve,reject) => {
      const tx = this.db.transaction('store','readonly');
      const request = tx.objectStore('store').get(`user:${this.userId}:rro-hub`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Could not read your saved links.'));
    });
  },
  async save(cards) {
    await this.checkSession();
    const next = this.validateCards(cards);
    await new Promise((resolve,reject) => {
      const tx = this.db.transaction('store','readwrite');
      tx.objectStore('store').put(next, `user:${this.userId}:rro-hub`);
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(new Error('Links could not be saved. Your previous links are unchanged.'));
    });
    this.cards = next; this.render();
  },
  status(message) { document.getElementById('hub-status').textContent = message; },
  element(tag,text) { const el = document.createElement(tag); if(text !== undefined) el.textContent = text; return el; },
  render() {
    document.getElementById('hub-heading').textContent = this.section === 'Home' ? 'Pinned resources' : this.section;
    document.querySelectorAll('#hub-sections button').forEach(button => button.setAttribute('aria-pressed',String(button.textContent === this.section)));
    const query = document.getElementById('hub-search').value.trim().toLowerCase();
    const visible = this.cards.filter(card => (query || (this.section === 'Home' ? card.pinned : card.section === this.section)) && (!query || `${card.title} ${card.note} ${card.section}`.toLowerCase().includes(query)));
    const root = document.getElementById('hub-cards'); root.replaceChildren();
    if (!visible.length) root.append(this.element('p','No resources here yet. Add a resource or pin one to Home.'));
    visible.forEach(card => {
      const article = this.element('article'); const category = this.element('span',card.section); category.className='category';
      article.append(category,this.element('h3',card.title),this.element('p',card.note));
      const actions = this.element('div'); actions.className='actions';
      if(card.url) {const link=this.element('a','Open resource ↗'); link.href=card.url; link.target='_blank'; link.rel='noopener noreferrer'; actions.append(link);} else actions.append(this.element('span','Link needed'));
      const edit=this.element('button','Edit'); edit.onclick=()=>this.edit(card); actions.append(edit);
      const remove=this.element('button','Remove'); remove.onclick=async()=>{if(confirm(`Remove “${card.title}”?`)) {try{await this.save(this.cards.filter(item=>item.id!==card.id));this.status('Resource removed.');}catch(error){this.status(error.message);}}}; actions.append(remove);
      article.append(actions); root.append(article);
    });
  },
  edit(card) {
    const current=card || {id:crypto.randomUUID(),title:'',section:this.section,url:'',note:'',pinned:this.section==='Home'};
    for(const field of ['id','title','url','note']) document.getElementById(`hub-${field}`).value=current[field];
    document.getElementById('hub-category').value=current.section;
    document.getElementById('hub-pinned').checked=current.pinned;
    document.getElementById('hub-form-error').textContent='';
    document.getElementById('hub-editor').showModal();
  },
  async init() {
    try {
      this.userId=(await this.checkSession()).id;
      this.db=await new Promise((resolve,reject)=>{const request=indexedDB.open('FlowDeskDB',2);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('store'))request.result.createObjectStore('store');};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Browser storage is unavailable.'));});
      const saved=await this.read(); this.cards=saved == null ? this.defaults() : this.validateCards(saved);
      this.sections.forEach(section=>{const button=this.element('button',section);button.onclick=()=>{this.section=section;this.render();};document.getElementById('hub-sections').append(button);const option=this.element('option',section);document.getElementById('hub-category').append(option);});
      document.getElementById('hub-search').oninput=()=>this.render();
      document.getElementById('hub-add').onclick=()=>this.edit();
      document.getElementById('hub-cancel').onclick=()=>document.getElementById('hub-editor').close();
      document.getElementById('hub-form').onsubmit=async event=>{
        event.preventDefault();const submit=event.submitter; if(submit)submit.disabled=true;
        try{const card={};for(const field of ['id','title','url','note'])card[field]=document.getElementById(`hub-${field}`).value;card.section=document.getElementById('hub-category').value;card.pinned=document.getElementById('hub-pinned').checked;await this.save([...this.cards.filter(item=>item.id!==card.id),card]);document.getElementById('hub-editor').close();this.status('Links saved in this browser.');}catch(error){document.getElementById('hub-form-error').textContent=error.message;}finally{if(submit)submit.disabled=false;}
      };
      document.getElementById('hub-export').onclick=async()=>{try{await this.checkSession();const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,cards:this.cards},null,2)],{type:'application/json'}));const link=this.element('a');link.href=url;link.download='rro-hub-links.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){this.status(error.message);}};
      document.getElementById('hub-import').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>2000000)throw new Error('This backup is too large.');const backup=JSON.parse(await file.text());if(backup.version!==1)throw new Error('Unsupported backup version.');const cards=this.validateCards(backup.cards);if(confirm('Replace your Hub links with this backup?')){await this.save(cards);this.status('Backup restored.');}}catch(error){this.status(error.message);}finally{event.target.value='';}};
      window.addEventListener('focus',async()=>{try{await this.checkSession();}catch(error){document.getElementById('hub-editor').close();document.getElementById('hub-main').hidden=true;this.cards=[];document.getElementById('hub-cards').replaceChildren();this.status(error.message);}});
      document.getElementById('hub-main').hidden=false;this.render();this.status('Your Hub is ready.');
    } catch(error) {this.status(error.message);}
  }
};
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>window.hub.init(),{once:true});else window.hub.init();
