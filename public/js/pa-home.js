(async()=>{
const notice=document.getElementById('notice');
const seedKey=new URLSearchParams(location.hash.slice(1)).get('import');
if(seedKey){sessionStorage.setItem('pa-import-key',seedKey);history.replaceState(null,'',location.pathname)}
async function start(){
const r=await fetch('/api/user/me');if(!r.ok){document.getElementById('login').hidden=false;notice.textContent='Welcome to your personal PA.';return}
document.getElementById('login').hidden=true;
const html=await fetch('/views/tasks.html').then(r=>r.text());document.getElementById('desk').innerHTML=html;
document.querySelectorAll('#desk .view-header,#tasks-masonry-board').forEach(x=>x.remove());
await paController.init();notice.textContent='Connected. Changes sync automatically while this page is open.';
const key=sessionStorage.getItem('pa-import-key');if(key){try{
const raw=await fetch('/pa-import.json').then(r=>r.json());const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const cryptoKey=await crypto.subtle.importKey('raw',bytes(key),{name:'AES-GCM'},false,['decrypt']);const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(raw.iv)},cryptoKey,bytes(raw.data));const rows=JSON.parse(new TextDecoder().decode(decoded));
for(const row of rows){if(!paController.tasks.some(t=>t.title===row.title)){await paController.request('/api/assistant/tasks',{method:'POST',body:JSON.stringify({...row,prepare:!row.completed,context:'Imported from planner photo; handwriting interpreted approximately. Review names and completion status.'})});await paController.refresh(true)}}sessionStorage.removeItem('pa-import-key');notice.textContent='Your planner is imported, including completed jobs. Your PA is preparing the outstanding jobs automatically.';
}catch(e){notice.textContent='Planner import paused. Reopen your private setup link to retry.'}}
}
document.getElementById('login').onsubmit=async e=>{e.preventDefault();try{await paController.request('/api/auth/login',{method:'POST',body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value,remember:true})});document.getElementById('password').value='';await start()}catch(e){notice.textContent=e.message}};
window.addEventListener('online',()=>start());
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js');
try{await start()}catch{notice.textContent='Could not connect. Keep any new task text here and retry when online.'}
})();
