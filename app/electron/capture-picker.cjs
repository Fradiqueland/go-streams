const path=require('node:path');
const fs=require('node:fs');
const supported=['en','pt-PT','es','fr','hi','ar','zh','bn','ru','id'];
const catalogs=new Map(),openPickers=new WeakSet();
function nativeText(locale,pt,en){
 if(locale==='pt-PT')return pt;if(!supported.includes(locale))locale='en';
 if(!catalogs.has(locale))try{catalogs.set(locale,JSON.parse(fs.readFileSync(path.join(__dirname,'../public/locales',locale+'.json'),'utf8')));}catch{catalogs.set(locale,{});}
 return catalogs.get(locale)[pt]||en;
}
function pickerLabels(locale){
 const t=(en,pt)=>nativeText(locale,pt,en);
 return {title:t('Share screen or window','Partilhar ecrã ou janela'),heading:t('Choose what to share','Escolha o que pretende partilhar'),hint:t('Only the selected screen or window will be captured.','Apenas o ecrã ou a janela selecionada serão captados.'),audio:t('System audio will also be shared. The microphone is controlled separately.','O áudio do sistema também será partilhado. O microfone é controlado separadamente.'),all:t('All sources','Todas as origens'),screens:t('Screens','Ecrãs'),windows:t('Windows','Janelas'),search:t('Search screens or windows','Pesquisar ecrãs ou janelas'),empty:t('No sources found. Try another search or reopen this picker.','Não foram encontradas origens. Altere a pesquisa ou reabra este seletor.'),cancel:t('Cancel','Cancelar'),share:t('Share selected source','Partilhar origem selecionada'),screen:t('Screen','Ecrã'),window:t('Window','Janela'),selected:t('Selected','Selecionado'),preview:t('Preview unavailable','Pré-visualização indisponível')};
}
function openCapturePicker({parent,BrowserWindow,ipcMain,sources,systemAudio=false,locale='en'}){
 if(!parent||parent.isDestroyed()||openPickers.has(parent)||!sources.length)return Promise.resolve(null);
 openPickers.add(parent);const labels=pickerLabels(locale);
 return new Promise(resolve=>{
  let picker,settled=false;
  const finish=source=>{if(settled)return;settled=true;ipcMain.removeListener('streamland-picker-ready',ready);ipcMain.removeListener('streamland-picker-select',select);parent.removeListener('closed',cancel);openPickers.delete(parent);if(picker&&!picker.isDestroyed())picker.destroy();resolve(source||null);};
  const cancel=()=>finish(null);
  const ready=event=>{
   if(event.sender!==picker?.webContents||settled)return;
   let screenNumber=0;
   event.sender.send('streamland-picker-data',{labels,rtl:locale==='ar',locale,systemAudio,sources:sources.map((source,index)=>({id:source.id,name:String(source.name||'').slice(0,500),type:source.id.startsWith('screen:')?'screen':'window',number:source.id.startsWith('screen:')?++screenNumber:index+1,thumbnail:source.thumbnail?.isEmpty?.()?'':source.thumbnail?.toDataURL?.()||''}))});
  };
  const select=(event,id)=>{if(event.sender!==picker?.webContents||settled)return;if(id===null)return cancel();const source=typeof id==='string'&&sources.find(source=>source.id===id);if(source)finish(source);};
  try{
   picker=new BrowserWindow({parent,modal:true,width:1000,height:740,minWidth:600,minHeight:480,show:false,title:'Streamland · '+labels.title,autoHideMenuBar:true,backgroundColor:'#f5f6fa',minimizable:false,webPreferences:{session:parent.webContents.session,preload:path.join(__dirname,'capture-picker-preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}});
   picker.setMenu?.(null);picker.webContents.setWindowOpenHandler(()=>({action:'deny'}));picker.webContents.on('will-navigate',event=>event.preventDefault());
   picker.once('closed',cancel);parent.once('closed',cancel);ipcMain.on('streamland-picker-ready',ready);ipcMain.on('streamland-picker-select',select);
   picker.once('ready-to-show',()=>{if(!settled)picker.show();});
   picker.loadFile(path.join(__dirname,'capture-picker.html')).catch(cancel);
  }catch{cancel();}
 });
}
module.exports={openCapturePicker,pickerLabels,nativeText,supported};
