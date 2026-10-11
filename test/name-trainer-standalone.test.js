const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(){const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'../public/name-trainer.html'),'utf8'),{runScripts:'outside-only'});dom.window.document.addEventListener=()=>{};dom.window.eval(fs.readFileSync(path.join(__dirname,'../public/js/name-trainer-standalone.js'),'utf8'));return {dom,trainer:dom.window.standaloneTrainer};}
test('standalone roster keeps only quiz data and rejects remote photo URLs',()=>{
  const {dom,trainer}=setup();const [student]=trainer.minimalRoster([{id:'1',name:'Test Pupil',year:'10',classes:['10A'],gender:'F',photo:'https://tracker.test/photo',sen:true,pp:true,catMean:'120'}]);
  assert.equal(student.photo,null);assert.equal(student.year,'10');assert.equal(student.classes[0],'10A');assert.equal('sen' in student,false);assert.equal('pp' in student,false);assert.equal('catMean' in student,false);
  assert.throws(()=>trainer.minimalRoster([{id:'1',name:'A'},{id:'1',name:'B'}]),/duplicate/);dom.window.close();
});
test('standalone import processes roster locally and atomically resets its own progress',async()=>{
  const {dom,trainer}=setup();let captured;let destroyed=0;
  dom.window.confirm=()=>true;dom.window.nametrainerController={destroy:async()=>destroyed++,init:async()=>{}};
  const area=dom.window.document.createElement('div');area.id='nt-quiz-area';dom.window.document.body.append(area);const empty=dom.window.document.createElement('div');empty.id='nt-empty-state';dom.window.document.body.append(empty);
  dom.window.Worker=class{postMessage(data){assert.equal(data.fileName,'roster.xlsx');queueMicrotask(()=>this.onmessage({data:{type:'done',roster:[{id:'1',name:'Test Pupil',year:'10',photo:'data:image/png;base64,AA=='}]}}));}terminate(){}};
  const operations=[];trainer.db={transaction(store,mode){assert.equal(store,'store');assert.equal(mode,'readwrite');const tx={objectStore:()=>({put:(value,key)=>{captured=value;operations.push(key);},delete:key=>operations.push(key)})};queueMicrotask(()=>tx.oncomplete());return tx;}};
  await trainer.importFile({name:'roster.xlsx',size:100,arrayBuffer:async()=>new ArrayBuffer(8)});
  assert.equal(destroyed,1);assert.equal(captured[0].name,'Test Pupil');assert.deepEqual(operations,['wholeSchoolRoster','nt_progress']);assert.match(dom.window.document.getElementById('trainer-status').textContent,/Imported 1 pupils/);assert.equal(trainer.importing,false);dom.window.close();
});
test('standalone storage failure rejects instead of reporting successful save',async()=>{
  const {dom,trainer}=setup();trainer.db={transaction(){const tx={objectStore:()=>({put:()=>({})})};queueMicrotask(()=>tx.onabort());return tx;}};
  await assert.rejects(trainer.store('set','nt_progress',{}),/storage/);dom.window.close();
});
