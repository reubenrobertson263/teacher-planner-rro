const test = require('node:test');
const assert = require('node:assert/strict');
const art = require('../public/js/bchs-art.js');
test('known phases and icon choices', () => {
 assert.deepEqual(Object.keys(art.phases), ['Retrieve','Learning Intentions','Explicit Instruction','Green Zone','Review']);
 assert.equal(art.pickVisual({title:'Primary versus secondary research'}).kind,'compare');
 assert.equal(art.pickVisual({title:'What makes a customer profile?'}).kind,'audience');
 assert.equal(art.pickVisual({title:'Calculate break-even'}).kind,'concept');
});
test('graphics labels are bounded, and no made-up chart values appear', () => {
 const v=art.pickVisual({visual:{kind:'data',items:['a','b','c','d','e'],values:[1,3]}});
 assert.deepEqual(v.values,[1,3]);assert.equal(v.items.length,4);
 assert.deepEqual(art.pickVisual({title:'Research findings'}).values,[]);
 assert.deepEqual(art.pickVisual({visual:{kind:'data',values:[-3,10]}}).values,[]);
});
test('editable styled slide has no white content cards', () => {
 const texts=[],shapes=[],notes=[];
 const slide={addText:(t,o)=>texts.push({t,o}),addShape:(type,o)=>shapes.push({type,o}),addNotes:x=>notes.push(x)};
 const pptx={ShapeType:{rect:'rect',line:'line',ellipse:'ellipse'},addSlide:()=>slide};
 art.drawSlide(pptx,{phase:'Green Zone',title:'🟢 Independent research practice',content:'1. Read your research aim.\n2. Select and justify a method.',minutes:28,keywords:['research','aim'],visual:{kind:'research',items:['Find evidence']}});
 assert.ok(texts.some(x=>String(x.t).includes('Green Zone')));
 assert.ok(texts.every(x=>x.o.fontFace==='Comic Sans MS'));
 assert.ok(shapes.some(x=>x.o.fill?.color==='F5BA46'));
 assert.ok(!shapes.some(x=>x.o.fill?.color==='FFFFFF'));
});
