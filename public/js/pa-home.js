(async()=>{
const notice=document.getElementById('notice');
const hashParams=new URLSearchParams(location.hash.slice(1));const seedKey=hashParams.get('import');const setupKey=hashParams.get('setup');if(setupKey){sessionStorage.setItem('pa-setup-key',setupKey);history.replaceState(null,'',location.pathname)}
if(seedKey){sessionStorage.setItem('pa-import-key',seedKey);history.replaceState(null,'',location.pathname)}
async function start(){
const r=await fetch('/api/user/me');if(!r.ok){document.getElementById('login').hidden=false;notice.textContent='Welcome to your personal PA.';return}
document.getElementById('login').hidden=true;
const html=await fetch('/views/tasks.html').then(r=>r.text());document.getElementById('desk').innerHTML=html;
document.querySelectorAll('#desk .view-header,#tasks-masonry-board').forEach(x=>x.remove());
await paController.init();notice.textContent='Connected. Saved jobs sync across your devices.';
const setup=sessionStorage.getItem('pa-setup-key');if(setup){try{
const raw=await fetch('/pa-setup.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Setup file unavailable');return r.json()});const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const k=await crypto.subtle.importKey('raw',bytes(setup),{name:'AES-GCM'},false,['decrypt']);const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(raw.iv)},k,bytes(raw.data));const pack=JSON.parse(new TextDecoder().decode(decoded));
const profile=await paController.request('/api/assistant/profile');const mark='FLOWDESK PA — REUBEN';if(!profile.text.includes(mark)){const merged=profile.text+'\n\n'+pack.profile;if(merged.length>10000)throw Error('Existing profile is too long to merge safely');await paController.request('/api/assistant/profile',{method:'PUT',body:JSON.stringify({text:merged,revision:profile.revision})})}
await paController.refresh(true);
for(const item of pack.drafts){let t=paController.tasks.find(x=>x.title===item.title);if(!t){t=await paController.request('/api/assistant/tasks',{method:'POST',body:JSON.stringify({title:item.title,prepare:false})});await paController.refresh(true)}if(!t.draft&&t.stage!=='done'&&t.stage!=='working'){await paController.request('/api/assistant/tasks/'+encodeURIComponent(t.id),{method:'PATCH',body:JSON.stringify({action:'save',revision:t.revision,title:t.title,context:t.context||'',draft:item.draft,stage:'ready',relatedIds:t.relatedIds||[]})});await paController.refresh(true)}}
sessionStorage.removeItem('pa-setup-key');await paController.loadProfile();notice.textContent='Profile and four drafts added. Open Ready to review them.';
}catch(e){notice.textContent='Setup paused: '+e.message+'. Reopen the private setup link to retry.'}}
const key=sessionStorage.getItem('pa-import-key');if(key){try{
const raw=await fetch('/pa-import.json').then(r=>r.json());const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const cryptoKey=await crypto.subtle.importKey('raw',bytes(key),{name:'AES-GCM'},false,['decrypt']);const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(raw.iv)},cryptoKey,bytes(raw.data));const rows=JSON.parse(new TextDecoder().decode(decoded));
for(const row of rows){if(!paController.tasks.some(t=>t.title===row.title)){await paController.request('/api/assistant/tasks',{method:'POST',body:JSON.stringify({...row,prepare:!row.completed,context:'Imported from planner photo; handwriting interpreted approximately. Review names and completion status.'})});await paController.refresh(true)}}sessionStorage.removeItem('pa-import-key');notice.textContent='Your planner is imported, including completed jobs. Your PA is preparing the outstanding jobs automatically.';
}catch(e){notice.textContent='Planner import paused. Reopen your private setup link to retry.'}}
}
document.getElementById('login').onsubmit=async e=>{e.preventDefault();try{await paController.request('/api/auth/login',{method:'POST',body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value,remember:true})});document.getElementById('password').value='';await start()}catch(e){notice.textContent=e.message}};
window.addEventListener('online',()=>{if(document.getElementById('pa-list')){notice.textContent='Back online. Saved jobs sync across your devices.';paController.refresh(true)}else start().catch(()=>{notice.textContent='Could not connect. Try again when online.'})});
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js');
try{await start()}catch{notice.textContent='Could not connect. Keep any new task text here and retry when online.'}
})();
