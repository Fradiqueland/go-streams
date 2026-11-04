const $=selector=>document.querySelector(selector);
window.streamlandPicker.ready(data=>{
 const {labels,sources}=data;let filter='all',selected=null;
 document.documentElement.lang=data.locale;document.documentElement.dir=data.rtl?'rtl':'ltr';document.title='Streamland · '+labels.title;$('h1').textContent=labels.heading;$('#hint').textContent=labels.hint;$('#audio').textContent=labels.audio;$('#audio').hidden=!data.systemAudio;
 for(const [type,label]of [['all',labels.all],['screen',labels.screens],['window',labels.windows]])$(`[data-filter="${type}"]`).textContent=label;
 $('#search').placeholder=labels.search;$('#search').setAttribute('aria-label',labels.search);$('#cancel').textContent=labels.cancel;$('#share').textContent=labels.share;$('#empty').textContent=labels.empty;
 function draw(){
  const search=$('#search').value.trim().toLocaleLowerCase();const matches=sources.filter(source=>(filter==='all'||source.type===filter)&&source.name.toLocaleLowerCase().includes(search));$('#sources').replaceChildren();$('#empty').hidden=matches.length>0;
  if(!matches.some(source=>source.id===selected))selected=null;
  for(const source of matches){
   const button=document.createElement('button');button.type='button';button.className='source';button.dataset.id=source.id;button.setAttribute('aria-pressed',String(source.id===selected));
   const title=source.type==='screen'?labels.screen+' '+source.number:source.name;
   const preview=document.createElement('span');preview.className='preview';
   if(/^data:image\/(?:png|jpeg);base64,[a-z\d+/=]+$/i.test(source.thumbnail)){const image=document.createElement('img');image.src=source.thumbnail;image.alt='';preview.append(image);}else preview.textContent=labels.preview;
   const name=document.createElement('span');name.className='source-name';name.textContent=title;name.title=source.name;
   const type=document.createElement('span');type.className='source-type';type.textContent=source.type==='screen'?labels.screen:labels.window;button.append(preview,name,type);button.addEventListener('click',()=>{selected=source.id;for(const card of document.querySelectorAll('.source'))card.setAttribute('aria-pressed',String(card.dataset.id===selected));selection();});$('#sources').append(button);
  }selection();
 }
 function selection(){const source=sources.find(source=>source.id===selected);$('#share').disabled=!source;$('#selection').textContent=source?labels.selected+': '+(source.type==='screen'?labels.screen+' '+source.number:source.name):'';}
 for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{filter=button.dataset.filter;for(const tab of document.querySelectorAll('[data-filter]'))tab.setAttribute('aria-pressed',String(tab===button));draw();});
 $('#search').addEventListener('input',draw);$('#cancel').addEventListener('click',()=>window.streamlandPicker.choose(null));$('#share').addEventListener('click',()=>{if(selected)window.streamlandPicker.choose(selected);});document.addEventListener('keydown',event=>{if(event.key==='Escape')window.streamlandPicker.choose(null);});draw();$('#search').focus();
});
