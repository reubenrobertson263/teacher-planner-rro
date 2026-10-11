'use strict';
window.standaloneTrainer = {
  db:null, worker:null, importing:false,
  status(message){document.getElementById('trainer-status').textContent=message;},
  async store(action,key,value){
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('store',action==='get'?'readonly':'readwrite');
      const store=tx.objectStore('store');const request=action==='get'?store.get(key):action==='delete'?store.delete(key):store.put(value,key);
      let result;request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(action==='get'?result:true);
      tx.onerror=tx.onabort=()=>reject(new Error('Browser storage could not be updated. Check available space and browser settings.'));
    });
  },
  minimalRoster(roster){
    if(!Array.isArray(roster)||!roster.length)throw new Error('No pupil rows were found.');
    const ids=new Set();
    return roster.map((student,index)=>{
      const id=String(student.id||`row-${index}`);if(ids.has(id))throw new Error('The spreadsheet contains duplicate pupil IDs.');ids.add(id);
      const name=String(student.name||'').trim();if(!name)throw new Error('A pupil row is missing its name.');
      const photo=/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.test(String(student.photo||''))?student.photo:null;
      return {id,name,year:String(student.year||student.yearGroup||''),classes:Array.isArray(student.classes)?student.classes.map(String):String(student.classes||''),gender:String(student.gender||student.sex||''),photo};
    });
  },
  async importFile(file){
    if(!file||this.importing)return;
    this.importing=true;document.getElementById('trainer-import').disabled=true;document.getElementById('trainer-clear').disabled=true;
    try{
      if(!/\.xlsx$/i.test(file.name))throw new Error('Choose an .xlsx file with embedded photos.');
      if(file.size>50*1024*1024)throw new Error('Choose a roster smaller than 50 MB.');
      if(!confirm('Replace the roster on this browser? Practice progress will reset.'))return;
      await window.nametrainerController.destroy();
      document.getElementById('nt-quiz-area').style.display='none';document.getElementById('nt-empty-state').style.display='block';
      const buffer=await file.arrayBuffer();
      const roster=await new Promise((resolve,reject)=>{
        const worker=this.worker=new Worker('/js/arbor-worker.js');
        const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Import took too long. Try a smaller roster.'));},120000);
        const done=()=>{clearTimeout(timeout);worker.terminate();this.worker=null;};
        worker.onmessage=event=>{const data=event.data;if(data.type==='progress')this.status(data.message);else if(data.type==='done'){done();resolve(data.roster);}else if(data.type==='error'){done();reject(new Error(data.message));}};
        worker.onerror=()=>{done();reject(new Error('Import failed. Check your connection and try again.'));};
        worker.postMessage({arrayBuffer:buffer,fileName:file.name},[buffer]);
      });
      const minimal=this.minimalRoster(roster);
      await new Promise((resolve,reject)=>{const tx=this.db.transaction('store','readwrite');tx.objectStore('store').put(minimal,'wholeSchoolRoster');tx.objectStore('store').delete('nt_progress');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(new Error('Not enough browser storage. The previous roster is unchanged.'));});
      await window.nametrainerController.init();
      this.status(`Imported ${minimal.length} pupils, including ${minimal.filter(s=>s.photo).length} photos. Choose a year or class and press Start.`);
    }catch(error){this.status(error.message);}finally{this.importing=false;document.getElementById('trainer-import').disabled=false;document.getElementById('trainer-clear').disabled=false;document.getElementById('trainer-import').value='';}
  },
  async clear(){
    if(this.importing||!confirm('Delete this browser’s Name Trainer roster and all practice progress? FlowDesk data is unaffected.'))return;
    await window.nametrainerController.destroy();
    await new Promise((resolve,reject)=>{const tx=this.db.transaction('store','readwrite');tx.objectStore('store').clear();tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(new Error('Could not clear browser data.'));});
    document.getElementById('nt-photo-box').replaceChildren();document.getElementById('nt-options-grid').replaceChildren();document.getElementById('nt-quiz-area').style.display='none';document.getElementById('nt-empty-state').style.display='block';await window.nametrainerController.init();this.status('Roster and progress cleared from this browser.');
  },
  async init(){
    try{
      this.db=await new Promise((resolve,reject)=>{const request=indexedDB.open('StandaloneNameTrainer',1);request.onupgradeneeded=()=>request.result.createObjectStore('store');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Enable browser storage to use Name Trainer.'));});
      window.idb={get:key=>this.store('get',key),set:(key,value)=>this.store('set',key,value)};
      window.app={escapeHTML:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),showToast:message=>this.status(message.replace(/Upload the current Arbor Master File in Settings first\./,'Import your Arbor roster above first.').replace(/in Settings/g,'above')),toggleMenu(){}};
      const response=await fetch('/views/nametrainer.html');if(!response.ok)throw new Error('Name Trainer could not load. Refresh and try again.');
      document.getElementById('trainer-root').innerHTML=(await response.text()).replace(/Upload your Master File in Settings to extract profile pictures and begin\./,'Import your roster above to extract profile pictures and begin.').replace('<i class="fas fa-play"></i>','').replace('<i class="fas fa-volume-up"></i>','Sound');
      document.getElementById('trainer-import').onchange=event=>this.importFile(event.target.files[0]);
      document.getElementById('trainer-clear').onclick=()=>this.clear().catch(error=>this.status(error.message));
      await window.nametrainerController.init();this.status('Ready. Import a roster or practise with the one saved in this browser.');
      window.addEventListener('pagehide',()=>{window.nametrainerController.destroy();if(this.worker)this.worker.terminate();});
    }catch(error){this.status(error.message);}
  }
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>window.standaloneTrainer.init(),{once:true});else window.standaloneTrainer.init();
