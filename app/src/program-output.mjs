import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const image=fileURLToPath(new URL('./assets/program.png',import.meta.url));
export function appendProgramOutput(inputs,encoding,_quality,_aspect,previous=''){
 if(!fs.statSync(image).isFile())throw Error('Program image unavailable.');
 const outputs=[...encoding],map=outputs.indexOf('-map');
 if(map<0)throw Error('Video mapping unavailable.');
 const index=inputs.filter(value=>value==='-i').length,graph=previous?[previous]:[];
 let source=outputs[map+1],filterIndex=outputs.indexOf('-vf');
 const label=value=>value.startsWith('[')?value:'['+value+']';
 if(filterIndex>=0){graph.push(label(source)+outputs[filterIndex+1]+'[programBase]');source='[programBase]';outputs.splice(filterIndex,2);}
 outputs[outputs.indexOf('-map')+1]='[programFinal]';
 graph.push(`[${index}:v:0]${label(source)}scale2ref=w='max(2,round(iw*0.15/2)*2)':h='max(1,round(ow*sar/mdar))':eval=frame[programImageScaled][programReference]`);
 graph.push('[programImageScaled]format=rgba,colorchannelmixer=aa=0.5[programImage]');
 const margin='max(8,round(min(main_w,main_h)*0.02))';
 graph.push(`[programReference][programImage]overlay=x='main_w-overlay_w-${margin}':y='${margin}':shortest=1:format=auto[programFinal]`);
 inputs.push('-loop','1','-framerate','1','-i',image,'-filter_complex_threads','1','-filter_complex',graph.join(';'),...outputs);
}
