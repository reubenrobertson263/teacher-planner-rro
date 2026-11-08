/* BCHS/RRO lesson artwork: editable vectors, deliberate whitespace, never white content cards. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BCHSArt=api;})(typeof window==='object'?window:globalThis,function(){
'use strict';
const phases={
'Retrieve':{colour:'D8332D',icon:'🧠'},'Learning Intentions':{colour:'F5BA46',icon:'🎯'},
'Explicit Instruction':{colour:'4D97D4',icon:'👩‍🏫'},'Green Zone':{colour:'58A94C',icon:'🧩'},
'Review':{colour:'8F37A4',icon:'🎯'}};
const kinds=['none','concept','compare','process','timeline','data','decision','research','audience','checklist'];
function pickVisual(item={}){
 const raw=item.visual&&typeof item.visual==='object'?item.visual:{};
 let kind=kinds.includes(raw.kind)?raw.kind:'';
 if(!kind){const t=(String(item.title||'')+' '+String(item.content||'')).toLowerCase();
 kind=/compare|versus|difference|primary.*secondary/.test(t)?'compare'
 :/steps|stages|process|sequence|journey/.test(t)?'process'
 :/trend|data|figures|graph/.test(t)?'data'
 :/risk|choice|decision|evaluate/.test(t)?'decision'
 :/customer|profile|segment|audience/.test(t)?'audience'
 :/research|survey|sampling/.test(t)?'research'
 :/review|check|criteria/.test(t)?'checklist':'concept';}
 const items=Array.isArray(raw.items)?raw.items.filter(x=>typeof x==='string').map(x=>x.trim().slice(0,55)).filter(Boolean).slice(0,4):[];
 const nums=Array.isArray(raw.values)?raw.values.slice(0,4).map(Number):[];
 return {kind,items,values:nums.every(n=>Number.isFinite(n)&&n>=0)?nums:[]};
}
function icon(kind,title){
 const t=String(title||'').toLowerCase();
 if(/tiktok|social media|online|digital/.test(t))return '📱';
 if(/research|survey|sample/.test(t))return '🔍';
 if(/cost|price|profit|money/.test(t))return '💷';
 if(/brand|logo/.test(t))return '🎨';
 if(/risk/.test(t))return '⚠️';
 return {compare:'⚖️',process:'🔄',timeline:'📅',data:'📊',decision:'🎯',research:'🔍',audience:'👥',checklist:'✅',concept:'💡'}[kind]||'💡';
}
function drawDiagram(slide,pptx,v,title,colour){
 const S=pptx.ShapeType||{};
 const txt=(t,x,y,w,h,size=17,bold=false,color='25252B')=>slide.addText(String(t),{x,y,w,h,fontFace:'Comic Sans MS',fontSize:size,bold,color,margin:0,fit:'shrink',align:'center',valign:'mid'});
 const ln=(x,y,w,h,c=colour,width=2)=>slide.addShape(S.line||'line',{x,y,w,h,line:{color:c,width}});
 const circle=(x,y,w,h)=>slide.addShape(S.ellipse||'ellipse',{x,y,w,h,line:{color:colour,width:2},fill:{color:'ECECEC',transparency:100}});
 const x=9.5,y=2.72;
 if(v.kind==='none')return;
 if(v.kind==='compare'){
  ln(x+1.55,y+.6,0,2.55,'B7BCC1',1.2);txt('⚖️',x+1.04,y-.35,1,1,43);
  txt(v.items[0]||'Option A',x-.05,y+.83,1.5,1.2,18,true);
  txt(v.items[1]||'Option B',x+1.66,y+.83,1.5,1.2,18,true);
  if(v.items[2])txt(v.items[2],x+.4,y+2.5,2.3,.6,13);
  return;
 }
 if(v.kind==='process'||v.kind==='timeline'){
  const a=v.items.length?v.items:['Explore','Decide','Explain'];const n=Math.min(a.length,4),dy=3/n;
  ln(x+.43,y+.45,0,dy*(n-1),'BEC0C2',2);
  for(let i=0;i<n;i++){circle(x+.1,y+i*dy+.15,.66,.66);txt(i+1,x+.13,y+i*dy+.19,.6,.53,15,true,colour);txt(a[i],x+.94,y+i*dy,2.14,.8,17,true);}
  return;
 }
 if(v.kind==='data'&&v.values.length>=2&&v.items.length>=v.values.length){
  const max=Math.max(1,...v.values);for(let i=0;i<v.values.length;i++){
   const yy=y+.1+i*2.9/v.values.length;
   txt(v.items[i],x,yy,1.35,.52,13);ln(x+1.35,yy+.52,1.55*v.values[i]/max,0,colour,8);
   txt(v.values[i],x+2.4,yy,.5,.38,12,true);
  }return;
 }
 circle(x+.66,y+.25,1.8,1.8);txt(icon(v.kind,title),x+.8,y+.4,1.48,1.44,56);
 const fallback={research:'Find useful evidence',audience:'Who is the customer?',decision:'Explain your decision',checklist:'Check your thinking',data:'What do the findings show?'};
 txt(v.items[0]||fallback[v.kind]||'Think · Apply · Explain',x-.1,y+2.42,3.2,.75,17,true,colour);
 if(v.items[1])txt(v.items[1],x-.1,y+3.17,3.2,.53,14);
}
function drawSlide(pptx,item,slideIndex=0,options={}){
 if(!pptx||typeof pptx.addSlide!=='function')throw new Error('PowerPoint generator is unavailable.');
 const S=pptx.ShapeType||{},phase=phases[item.phase]?item.phase:'Explicit Instruction',theme=phases[phase],v=pickVisual(item);
 const body=String(item.content||' '),lines=body.replace(/\r/g,'').split('\n');
 const illustrated=v.kind!=='none'&&body.length<=630&&lines.length<=11&&options.visuals!==false;
 const slide=pptx.addSlide();slide.background={color:'ECECEC'};
 slide.addShape(S.rect||'rect',{x:0,y:0,w:.42,h:7.5,line:{color:'2D8796',transparency:100},fill:{color:'2D8796'}});
 slide.addText(theme.icon+' '+phase,{x:.83,y:.29,w:8.1,h:.78,fontFace:'Comic Sans MS',fontSize:33,bold:true,color:theme.colour,margin:0,fit:'shrink'});
 slide.addShape(S.line||'line',{x:.86,y:1.27,w:5.4,h:0,line:{color:theme.colour,width:2,endArrowType:'triangle'}});
 const keys=Array.isArray(item.keywords)?item.keywords.filter(k=>typeof k==='string').slice(0,7).map(k=>k.trim().slice(0,24)).filter(Boolean):[];
 if(keys.length){
  slide.addShape(S.rect||'rect',{x:9,y:.11,w:4.1,h:1.18,line:{color:'F5BA46',transparency:100},fill:{color:'F5BA46',transparency:12}});
  slide.addText('KEYWORDS',{x:9.18,y:.14,w:3.6,h:.31,fontFace:'Comic Sans MS',fontSize:14,bold:true,color:'8A510B',margin:0});
  slide.addText(keys.join('  ·  '),{x:9.18,y:.47,w:3.64,h:.71,fontFace:'Comic Sans MS',fontSize:11,color:'4E412F',margin:0,fit:'shrink'});
 }
 slide.addText(String(item.title||'Lesson').slice(0,200),{x:.97,y:1.63,w:11.4,h:.69,fontFace:'Comic Sans MS',fontSize:25,bold:true,color:'25272D',margin:0,fit:'shrink'});
 const size=body.length>640?17:body.length>420?19:21;
 slide.addText(body,{x:1.02,y:2.62,w:illustrated?8.15:11.3,h:4.06,fontFace:'Comic Sans MS',fontSize:size,color:'22252D',margin:0,fit:'shrink',valign:'top',paraSpaceAfterPt:7});
 if(illustrated)drawDiagram(slide,pptx,v,item.title,theme.colour);
 slide.addText('Blackburn Central High School',{x:9.55,y:7.05,w:3.3,h:.21,fontFace:'Comic Sans MS',fontSize:11,bold:true,color:'612C7D',margin:0,align:'right'});
 if(Number(item.minutes)>0)slide.addText(String(item.minutes)+' min',{x:1,y:6.98,w:1.25,h:.25,fontFace:'Comic Sans MS',fontSize:12,color:'61656A',margin:0});
 if(item.speakerNotes&&typeof slide.addNotes==='function')slide.addNotes(String(item.speakerNotes));
 return slide;
}
return {phases,kinds,pickVisual,drawSlide};
});