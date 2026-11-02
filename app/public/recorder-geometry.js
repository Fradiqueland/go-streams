const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Number(value):min));
export function cropRect(value={}){
 const width=clamp(value.width??1,.05,1),height=clamp(value.height??1,.05,1);
 return {x:clamp(value.x??0,0,1-width),y:clamp(value.y??0,0,1-height),width,height};
}
export function cameraPosition(value={}){
 return {x:clamp(value.x??.96,0,1),y:clamp(value.y??.96,0,1),size:clamp(value.size??.28,.1,.65)};
}
export function cameraRect(value={},width,height){
 const position=cameraPosition(value),side=position.size*Math.min(width,height);
 return {x:position.x*(width-side),y:position.y*(height-side),width:side,height:side};
}
export const recordingAspects=Object.freeze(['original','16:9','9:16','1:1','4:3','3:4']);
export function frameSize(width,height,crop={},quality=1080,aspect='original'){
 if(aspect!=='original'&&recordingAspects.includes(aspect)){
  const [x,y]=aspect.split(':').map(Number),short=Math.min(x,y),long=Math.max(x,y),limit=Number(quality)||1080;
  const multiple=Math.max(2,Math.floor(Math.min(limit/short,limit*16/9/long)/2)*2);
  return {width:x*multiple,height:y*multiple};
 }
 const r=cropRect(crop),w=Math.max(2,width*r.width),h=Math.max(2,height*r.height),ratio=Math.min(1,quality/h,quality*16/9/w);
 return {width:Math.max(2,Math.floor(w*ratio/2)*2),height:Math.max(2,Math.floor(h*ratio/2)*2)};
}
export function watermarkRect(width,height){
 const w=Math.max(2,Math.round(width*.15/2)*2),h=Math.max(1,Math.round(w*948/1660)),margin=Math.max(8,Math.round(Math.min(width,height)*.02));
 return {x:width-w-margin,y:margin,width:w,height:h};
}
export function containedRect(box,width,height){
 const ratio=Math.min(box.width/width,box.height/height),w=width*ratio,h=height*ratio;
 return {left:box.left+(box.width-w)/2,top:box.top+(box.height-h)/2,width:w,height:h};
}
export function selectionRect(start,end){
 return cropRect({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});
}
