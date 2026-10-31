const {appUrl}=require('./window-policy.cjs');

// Electron rejects a reply after its requesting frame has gone away. Settle at
// most once: retrying that callback would only throw again in the main process.
function answerOnce(callback){let answered=false;return value=>{if(answered)return;answered=true;try{callback(value);}catch{}};}

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
  if(!current()||request.securityOrigin!==base||!request.userGesture||!request.videoRequested)return answer(null);
  Promise.resolve().then(async()=>{
   const sources=await getSources();
   if(!current())return answer(null);
   const selected=await chooseSource(sources,{systemAudio:request.audioRequested&&platform==='win32'});
   if(!selected||!sources.includes(selected)||!current())return answer(null);
   answer({video:selected,...(request.audioRequested&&platform==='win32'?{audio:'loopback'}:{})});
  }).catch(()=>answer(null));
 });
}
module.exports={wireCapturePermissions};
