const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('streamlandPicker',{
 ready:callback=>{ipcRenderer.once('streamland-picker-data',(_event,data)=>callback(data));ipcRenderer.send('streamland-picker-ready');},
 choose:id=>{if(id===null||typeof id==='string'&&id.length<256)ipcRenderer.send('streamland-picker-select',id);}
});
