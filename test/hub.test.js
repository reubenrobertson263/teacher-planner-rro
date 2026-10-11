const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
function loadHub() {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname,'../public/hub.html'),'utf8'), {runScripts:'outside-only',url:'https://example.test/hub.html'});
  dom.window.document.addEventListener = () => {};
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../public/js/hub.js'),'utf8'));
  return {dom,hub:dom.window.hub};
}
test('Hub accepts web links but rejects active content and embedded credentials',()=>{
  const {dom,hub}=loadHub();
  assert.equal(hub.safeUrl('https://school.test/resources'),'https://school.test/resources');
  for(const url of ['javascript:alert(1)','data:text/html,hello','https://name:secret@school.test']) assert.throws(()=>hub.safeUrl(url));
  dom.window.close();
});
test('Hub restores all five sections without copying expired links or school secrets',()=>{
  const {dom,hub}=loadHub();const cards=hub.validateCards(hub.defaults());
  assert.equal(new Set(cards.map(c=>c.section)).size,5);
  assert.ok(cards.every(c=>c.url===''));
  assert.throws(()=>hub.validateCards([...cards,cards[0]]));
  dom.window.close();
});
test('Hub renders untrusted titles as text and searches across sections',()=>{
  const {dom,hub}=loadHub();hub.cards=[{id:'test',section:'Teaching',title:'<img src=x onerror=alert(1)>',note:'Coursework checklist',url:'',pinned:false}];
  dom.window.document.getElementById('hub-search').value='coursework';hub.render();
  assert.equal(dom.window.document.querySelectorAll('article').length,1);
  assert.equal(dom.window.document.querySelectorAll('article img').length,0);
  assert.match(dom.window.document.querySelector('article h3').textContent,/<img/);
  dom.window.close();
});
test('Hub refuses account changes before writing browser data',async()=>{
  const {dom,hub}=loadHub();hub.userId='first';dom.window.fetch=async()=>({ok:true,json:async()=>({id:'second'})});
  let writes=0;hub.db={transaction(){writes++;}};
  await assert.rejects(hub.save(hub.defaults()),/account changed/);assert.equal(writes,0);
  dom.window.close();
});
test('Name Trainer supports array classes and shows exactly four choices around a photo',async()=>{
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public/views/nametrainer.html'),'utf8'),{runScripts:'outside-only'});
  let writes=0;dom.window.idb={get:async()=>({}),set:async()=>{writes++;return true;}};
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../public/js/nametrainer.js'),'utf8'));
  const trainer=dom.window.nametrainerController;trainer.isNTSoundMuted=true;
  assert.equal(trainer.classTokens({classes:['10A','10B']}).length,2);
  assert.equal(trainer.studentInSelectedClass({classes:'10AB,10B'},'10A'),false);
  trainer.ntActiveRoster=[1,2,3,4].map(id=>({id,name:`Pupil ${id}`,photo:'data:image/png;base64,AA=='}));
  await trainer.loadNextNTCard();assert.equal(dom.window.document.querySelectorAll('#nt-options-grid button').length,4);
  assert.ok(dom.window.document.querySelector('#nt-photo-box img'));
  await Promise.all([trainer.processNTResult(true),trainer.processNTResult(true)]);assert.equal(writes,1);
  await trainer.destroy();dom.window.close();
});
