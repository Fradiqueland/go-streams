import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {outputDimensions} from './encoding.mjs';

const image=fileURLToPath(new URL('./assets/program.png',import.meta.url));
export function appendProgramOutput(inputs,encoding,quality,aspect,previous='',dimensions){
 if(!fs.statSync(image).isFile())throw Error('Program image unavailable.');
 const outputs=[...encoding],map=outputs.indexOf('-map');
 if(map<0)throw Error('Video mapping unavailable.');
 const [width,height]=dimensions||outputDimensions(quality,aspect),size=Math.max(2,Math.round(width*.15/2)*2),margin=Math.max(8,Math.round(Math.min(width,height)*.02));
 const index=inputs.filter(value=>value==='-i').length,graph=previous?[previous]:[];
 let source=outputs[map+1],filterIndex=outputs.indexOf('-vf');
 const label=value=>value.startsWith('[')?value:'['+value+']';
 if(filterIndex>=0){graph.push(label(source)+outputs[filterIndex+1]+'[programBase]');source='[programBase]';outputs.splice(filterIndex,2);}
 outputs[outputs.indexOf('-map')+1]='[programFinal]';
 graph.push(`[${index}:v:0]scale=${size}:-1,format=rgba,colorchannelmixer=aa=0.5[programImage]`);
 graph.push(`${label(source)}[programImage]overlay=x=main_w-overlay_w-${margin}:y=${margin}:shortest=1:format=auto[programFinal]`);
 inputs.push('-loop','1','-framerate','1','-i',image,'-filter_complex_threads','1','-filter_complex',graph.join(';'),...outputs);
}
