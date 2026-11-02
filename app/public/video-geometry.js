// Shared by the browser preview and server encoder. Quality names refer to
// the short edge, so portrait and landscape use the same pixel density.
export const videoAspects=Object.freeze(['16:9','9:16','1:1','4:3','3:4','21:9']);
export function videoDimensions(quality,aspect){
 if(!videoAspects.includes(aspect))throw new RangeError('Unsupported video aspect ratio.');
 const base=quality==='1080p'?1080:720,[width,height]=aspect.split(':').map(Number);
 return width>=height?[Math.round(base*width/height/2)*2,base]:[base,Math.round(base*height/width/2)*2];
}
