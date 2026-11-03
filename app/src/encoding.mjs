import { AppError } from './errors.mjs';
import {videoAspects as encodingAspects,videoDimensions as outputDimensions} from '../public/video-geometry.js';
export {encodingAspects,outputDimensions};

export const encodingDefaults = { copy: false, videoBitrate: 2500, audioBitrate: 128, fps: 30, aspect: '16:9' };
export function validateEncoding(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Configuração de codificação inválida.');
  const output = { ...encodingDefaults, ...input };
  if (typeof output.copy !== 'boolean' || ![500,1000,2000,2500,3000,4500,5000,8000,10000].includes(output.videoBitrate) || ![64,96,128,192,256,320].includes(output.audioBitrate) || ![25,30,60].includes(output.fps) || !encodingAspects.includes(output.aspect)) throw new AppError('Escolha valores de codificação suportados.');
  return Object.fromEntries(Object.keys(encodingDefaults).map(k => [k, output[k]]));
}
export function encodingArgs(settings, quality, media, { preview = false } = {}) {
  const profile = validateEncoding(settings || { ...encodingDefaults, videoBitrate: quality === '1080p' ? 4500 : 2500 });
  if (profile.copy) {
    if (media.some(m => m.codec !== 'h264' || (m.audio && m.audio.codec !== 'aac'))) throw new AppError('A cópia direta requer vídeo H.264 e áudio AAC. Desative a cópia direta ou normalize os vídeos.');
    return { profile, needsSilence: false, args: ['-map','0:v:0','-map','0:a:0?','-c','copy'] };
  }
  const [width,height] = outputDimensions(quality,profile.aspect);
  return { profile, needsSilence: !media[0].audio, args: ['-map','0:v:0','-map',media[0].audio ? '0:a:0' : '1:a:0','-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${profile.fps}`,'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-b:v',`${profile.videoBitrate}k`,'-maxrate',`${profile.videoBitrate}k`,'-bufsize',`${profile.videoBitrate*2}k`,'-g',String(profile.fps*2),'-c:a','aac','-b:a',`${profile.audioBitrate}k`,'-ar','48000','-ac','2','-shortest'] };
}
