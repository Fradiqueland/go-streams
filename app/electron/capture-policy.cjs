const {appUrl}=require('./window-policy.cjs');

// Electron rejects a reply after its requesting frame has gone away. Settle at
// most once: retrying that callback would only throw again in the main process.
function answerOnce(callback){let answered=false;return value=>{if(answered)return;answered=true;try{callback(value);}catch{}};}

// Electron serializes a display request origin as a root URL, including '/'.
// Canonicalize that form without accepting credentials, paths, queries or fragments.
function captureOrigin(value,base){
 if(typeof value!=='string')return false;
 try{return new URL(value).href===base+'/';}catch{return false;}
}

async function chooseCaptureSource(sources,{showMessageBox,systemAudio=false}){
 if(!sources.length)return null;
 const pageSize=8,pages=Math.ceil(sources.length/pageSize);let page=0;
 for(;;){
  const start=page*pageSize,options=sources.slice(start,start+pageSize);
  const buttons=['Cancel',...options.map((source,index)=>`${start+index+1}. ${source.name.slice(0,100)}`)];
  const previous=page>0?buttons.push('Previous page')-1:-1,next=page+1<pages?buttons.push('Next page')-1:-1;
  const audio=systemAudio?'System audio will also be captured. Your microphone is controlled separately.':'Only the selected screen or window will be captured.';
  const result=await showMessageBox({type:'question',title:'Streamland - Share screen or window',message:'Choose what to share',detail:audio+(pages>1?` Page ${page+1} of ${pages}. Use the page buttons to see other screens and windows.`:''),buttons,defaultId:0,cancelId:0});
  const selected=result.response;
  if(!Number.isInteger(selected)||selected<=0)return null;
  if(selected<=options.length)return options[selected-1];
  if(selected===previous){page--;continue;}
  if(selected===next){page++;continue;}
  return null;
 }
}

function wireCapturePermissions(browserSession,{contents,base,confirmMedia,chooseSource,getSources,platform=process.platform}){
 const granted=new Set();
 const trusted=(wc,url)=>wc===contents&&!contents.isDestroyed()&&appUrl(url,base)&&appUrl(contents.getURL(),base);
 browserSession.setPermissionCheckHandler((wc,permission,origin,details={})=>{
  if(!trusted(wc,origin)||details.isMainFrame===false||(details.requestingUrl&&!appUrl(details.requestingUrl,base)))return false;
  if(permission==='media')return details.mediaType==='audio'||details.mediaType==='video'?granted.has(details.mediaType):granted.has('audio')&&granted.has('video');
  return false; // A screen or window must be selected for every new capture.
 });
 browserSession.setPermissionRequestHandler((wc,permission,callback,details={})=>{
  const answer=answerOnce(callback);
  if(!trusted(wc,details.requestingUrl)||details.isMainFrame===false||!['media','display-capture'].includes(permission))return answer(false);
  if(permission==='display-capture')return answer(true); // The source picker supplies explicit consent.
  const types=details.mediaTypes?.length?[...new Set(details.mediaTypes)]:['audio','video'];
  if(types.some(type=>!['audio','video'].includes(type)))return answer(false);
  Promise.resolve().then(()=>confirmMedia(types)).then(ok=>{
   const allowed=ok===true&&trusted(wc,details.requestingUrl);
   if(allowed)for(const type of types)granted.add(type);
   answer(allowed);
  },()=>answer(false));
 });
 browserSession.setDisplayMediaRequestHandler((request,callback)=>{
  const answer=answerOnce(callback);
  const current=()=>!contents.isDestroyed()&&request.frame&&request.frame===contents.mainFrame&&appUrl(contents.getURL(),base);
  if(!current()||!captureOrigin(request.securityOrigin,base)||!request.userGesture||!request.videoRequested)return answer(null);
  Promise.resolve().then(async()=>{
   const sources=await getSources();
   if(!current())return answer(null);
   const selected=await chooseSource(sources,{systemAudio:request.audioRequested&&platform==='win32'});
   if(!selected||!sources.includes(selected)||!current())return answer(null);
   answer({video:selected,...(request.audioRequested&&platform==='win32'?{audio:'loopback'}:{})});
  }).catch(()=>answer(null));
 });
}
module.exports={wireCapturePermissions,chooseCaptureSource};
