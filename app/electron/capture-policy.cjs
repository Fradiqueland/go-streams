const {appUrl}=require('./window-policy.cjs');

function wireCapturePermissions(browserSession,{contents,base,confirmMedia,chooseSource,getSources,platform=process.platform}){
 const granted=new Set();
 const trusted=(wc,url)=>wc===contents&&!contents.isDestroyed()&&appUrl(url,base);
 browserSession.setPermissionCheckHandler((wc,permission,origin)=>{
  return trusted(wc,origin)&&granted.has(permission);
 });
 browserSession.setPermissionRequestHandler((wc,permission,callback,details)=>{
  if(!trusted(wc,details.requestingUrl)||details.isMainFrame===false||!['media','display-capture'].includes(permission))return callback(false);
  if(permission==='display-capture'){granted.add(permission);return callback(true);} // The source picker supplies explicit consent.
  Promise.resolve(confirmMedia(details.mediaTypes||[])).then(ok=>{
   const allowed=ok===true&&trusted(wc,details.requestingUrl);
   if(allowed)granted.add(permission);
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
