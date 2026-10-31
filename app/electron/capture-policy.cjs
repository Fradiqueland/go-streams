const {appUrl}=require('./window-policy.cjs');

function wireCapturePermissions(browserSession,{contents,base,confirmMedia,chooseSource,getSources,platform=process.platform}){
 const granted=new Set();
 const trusted=(wc,url)=>wc===contents&&!contents.isDestroyed()&&appUrl(url,base)&&appUrl(contents.getURL(),base);
 browserSession.setPermissionCheckHandler((wc,permission,origin,details={})=>{
  if(!trusted(wc,origin)||details.isMainFrame===false||(details.requestingUrl&&!appUrl(details.requestingUrl,base)))return false;
  if(permission==='media')return details.mediaType==='audio'||details.mediaType==='video'?granted.has(details.mediaType):granted.has('audio')&&granted.has('video');
  return false; // A screen or window must be selected for every new capture.
 });
 browserSession.setPermissionRequestHandler((wc,permission,callback,details)=>{
  if(!trusted(wc,details.requestingUrl)||details.isMainFrame===false||!['media','display-capture'].includes(permission))return callback(false);
  if(permission==='display-capture')return callback(true); // The source picker supplies explicit consent.
  const types=details.mediaTypes?.length?[...new Set(details.mediaTypes)]:['audio','video'];
  if(types.some(type=>!['audio','video'].includes(type)))return callback(false);
  Promise.resolve().then(()=>confirmMedia(types)).then(ok=>{
   const allowed=ok===true&&trusted(wc,details.requestingUrl);
   if(allowed)for(const type of types)granted.add(type);
   callback(allowed);
  },()=>callback(false));
 });
 browserSession.setDisplayMediaRequestHandler((request,callback)=>{
  if(!request.frame||request.frame!==contents.mainFrame||request.securityOrigin!==base||!request.userGesture||!request.videoRequested)return callback(null);
  Promise.resolve().then(async()=>{
   const sources=await getSources();
   const selected=await chooseSource(sources,{systemAudio:request.audioRequested&&platform==='win32'});
   if(!selected||!sources.includes(selected)||contents.isDestroyed()||request.frame!==contents.mainFrame||!appUrl(contents.getURL(),base))return callback(null);
   callback({video:selected,...(request.audioRequested&&platform==='win32'?{audio:'loopback'}:{})});
  }).catch(()=>callback(null));
 });
}
module.exports={wireCapturePermissions};
