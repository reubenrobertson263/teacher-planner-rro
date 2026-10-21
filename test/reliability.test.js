const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function frontend(){const context={window:{},document:{readyState:'loading',addEventListener(){}},navigator:{onLine:true},fetch:null,setTimeout,clearTimeout,AbortController,TypeError,console};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8'),context);context.window.app.currentUser={id:'teacher'};context.window.app.showToast=()=>{};return context;}
test('sync preserves edits appended while a previous edit is being sent',async()=>{
  const c=frontend();let rows=[{id:'old',url:'/api/notes',options:{}}];c.window.idb={get:async()=>structuredClone(rows),update:async(key,change)=>(rows=change(rows))};
  c.fetch=async()=>{rows.push({id:'new',url:'/api/notes',options:{}});return {ok:true};};await c.window.flowSync.flush();assert.deepEqual(rows.map(r=>r.id),['new']);
});
test('sync stops on failure so newer changes cannot overtake failed older changes',async()=>{
  const c=frontend();let rows=[{id:'old',url:'/api/notes'},{id:'new',url:'/api/notes'}];let calls=0;c.window.idb={get:async()=>rows,update:async(key,change)=>(rows=change(rows))};c.fetch=async()=>{calls++;return {ok:false,status:503};};await c.window.flowSync.flush();assert.equal(calls,1);assert.equal(rows.length,2);
});
test('server outage queues a save exactly once and returns the offline result',async()=>{
  const c=frontend();let rows=[];c.window.idb={update:async(key,change)=>(rows=change(rows))};c.fetch=async()=>({ok:false,status:503});assert.equal(await c.window.flowSync.request('/api/notes',{},true),null);assert.equal(rows.length,1);
});
test('calendar saves use calendar API and do not report success or change local dates after failure',async()=>{
  const c=frontend();const messages=[];const writes=[];const elements={'setting-term-start':{value:'01/09/2026'},'setting-holidays':{value:''}};
  c.document.getElementById=id=>elements[id];c.localStorage={setItem:(key,value)=>writes.push([key,value])};c.window.app.showToast=message=>messages.push(message);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/js/settings.js'),'utf8'),c);let request;
  c.fetch=async(url,options)=>{request={url,options};return {ok:false,json:async()=>({error:{message:'Database unavailable'}})};};
  const button={innerHTML:'Save',disabled:false};await c.window.settingsController.saveDataSettings(button);assert.equal(request.url,'/api/settings/calendar');assert.equal(request.options.method,'PUT');assert.equal(writes.length,0);assert.deepEqual(messages,['Database unavailable']);assert.equal(button.disabled,false);
  c.fetch=async()=>({ok:true,json:async()=>({success:true})});await c.window.settingsController.saveDataSettings(button);assert.equal(c.window.holidays.length,0);assert.equal(messages.at(-1),'Calendar saved');assert.equal(writes.length,2);
});
