export function ebmlElement(id,body=Buffer.alloc(0)){
 if(typeof body==='number')body=Buffer.from([body]);else if(typeof body==='string')body=Buffer.from(body);
 let length=1;while(body.length>=2**(7*length)-1)length++;const size=Buffer.alloc(length);let remaining=body.length;
 for(let at=length-1;at>=0;at--){size[at]=remaining&255;remaining=Math.floor(remaining/256);}size[0]|=1<<(8-length);
 return Buffer.concat([Buffer.from(id,'hex'),size,body]);
}
export function webmHeader({codec='V_VP8',range,matrix,videoExtra=Buffer.alloc(0),trackExtra=Buffer.alloc(0),documentType='webm'}={}){
 const colour=Buffer.concat([...(range===undefined?[]:[ebmlElement('55b9',range)]),...(matrix===undefined?[]:[ebmlElement('55b1',matrix)])]);
 const video=ebmlElement('e0',Buffer.concat([ebmlElement('b0',16),ebmlElement('ba',16),...(colour.length?[ebmlElement('55b0',colour)]:[]),videoExtra]));
 const track=ebmlElement('ae',Buffer.concat([ebmlElement('83',1),ebmlElement('86',codec),video,trackExtra]));
 return Buffer.concat([ebmlElement('1a45dfa3',ebmlElement('4282',documentType)),Buffer.from('18538067ff','hex'),ebmlElement('1654ae6b',track)]);
}
