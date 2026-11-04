import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {runProcess,toolsFor} from '../src/core.mjs';
import {pcmTonePowers} from './audio-analysis.mjs';

export async function verifyBumpers({page,app,directory,report,pick}){
 const {ffmpeg,ffprobe}=toolsFor(app.store.data.settings),panel=page.locator('.recorder-studio'),production=panel.locator('.production-tools');let checks=0;
 const button=action=>panel.locator(`[data-recorder="${action}"]`),field=name=>panel.locator(`[name="${name}"]`),source=phase=>production.locator(`[data-bumper-source="${phase}"]`);
 await field('mode').selectOption('screen');await field('sound').selectOption('none');await field('aspect').selectOption('16:9');await field('countdown').selectOption('0');
 await production.locator('.production-clips > summary').evaluate(el=>{el.parentElement.open=true;});
 const clips=[];
 for(const [phase,color,tone]of [['intro','cyan',1200],['outro','yellow',1600]]){
  const file=path.join(directory,`automatic-${phase}.mp4`);await runProcess(ffmpeg,['-v','error','-f','lavfi','-i',`color=c=${color}:s=640x360:r=30:d=2`,'-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000:duration=2`,'-shortest','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-y',file]);
  pick([file]);await production.locator(`[data-bumper-import="${phase}"]`).click();await page.waitForFunction(phase=>Boolean(document.querySelector(`.recorder-studio [data-bumper-source="${phase}"]`).value),phase);clips.push({file,id:await source(phase).inputValue()});checks++;
 }
 // Verify link selection uses the existing authenticated import API. The
 // provider response is controlled here; remote proxy/SSRF tests cover the server.
 let linkedUrl;await page.route('**/api/media/link',async route=>{linkedUrl=route.request().postDataJSON().url;await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:clips[0].id})});},{times:1});
 await production.locator('[data-bumper-link="intro"]').fill('https://example.com/intro.mp4');await production.locator('[data-bumper-add="intro"]').click();await page.waitForFunction(()=>!document.querySelector('.recorder-studio [data-bumper-add="intro"]').disabled);assert.equal(linkedUrl,'https://example.com/intro.mp4');assert.equal(await source('intro').inputValue(),clips[0].id);checks++;
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('go-streams-recorder-scenes-bumpers')));assert.equal(saved.intro,clips[0].id);assert.equal(saved.outro,clips[1].id);checks++;
 await button('prepare').click();await page.waitForFunction(()=>Boolean(document.querySelector('.recorder-preview').srcObject));await button('full-area').click();await field('layout').selectOption('screen');
 await button('start').click();await page.waitForFunction(()=>!document.querySelector('[data-recorder="stop"]').disabled);assert.equal(await source('intro').isDisabled(),true);
 await page.waitForFunction(()=>document.querySelector('.recorder-studio [data-bumper-skip]').hidden);await page.waitForTimeout(1300);await button('stop').click();
 await page.waitForFunction(()=>!document.querySelector('.recorder-studio [data-bumper-skip]').hidden);assert.equal(app.recordings.active.size,1,'Outro must play before the recording writer is finalized');
 await page.waitForFunction(()=>document.querySelector('.recorder-status').textContent.includes('saved locally'));const item=app.recordings.items[0],file=app.recordings.media(item.id);
 const metadata=JSON.parse((await runProcess(ffprobe,['-v','error','-show_streams','-show_format','-of','json',file])).stdout),duration=Number(metadata.format.duration);assert.ok(duration>=5,'Both clips and the main programme must be retained');assert.equal(metadata.streams.find(stream=>stream.codec_type==='audio').codec_name,'aac');checks++;
 for(const [phase,at,expected,tone]of [['intro',.5,[0,255,255],1200],['outro',duration-.6,[255,255,0],1600]]){
  const pixel=path.join(directory,`auto-${phase}.rgb`);await runProcess(ffmpeg,['-v','error','-ss',String(at),'-i',file,'-frames:v','1','-vf','crop=2:2:20:20','-f','rawvideo','-pix_fmt','rgb24','-y',pixel]);assert.ok([...fs.readFileSync(pixel).subarray(0,3)].every((value,i)=>Math.abs(value-expected[i])<25),`${phase} picture must be present in the saved file`);
  const pcm=path.join(directory,`auto-${phase}.pcm`);await runProcess(ffmpeg,['-v','error','-ss',String(at),'-i',file,'-t','.4','-vn','-ac','1','-ar','8000','-f','s16le','-y',pcm]);const powers=pcmTonePowers(fs.readFileSync(pcm),[1200,1600]);assert.ok(powers[tone]>powers[tone===1200?1600:1200]*100,`${phase} audio must be encoded even with main audio disabled`);checks++;
 }
 const tail=path.join(directory,'auto-final.rgb');await runProcess(ffmpeg,['-v','error','-i',file,'-vf','crop=2:2:20:20','-f','rawvideo','-pix_fmt','rgb24','-y',tail]);assert.ok([...fs.readFileSync(tail).subarray(-12,-9)].every((value,i)=>Math.abs(value-[255,255,0][i])<25),'The final encoded frame must remain the outro');checks++;
 // Actual UI cancellation and deletion: dismissed confirmation preserves the
 // finished file, accepted confirmation removes it and its list entry.
 const remove=panel.locator(`[data-recorder="delete"][data-id="${item.id}"]`);page.once('dialog',dialog=>dialog.dismiss());await remove.click();assert.ok(fs.existsSync(file));assert.ok(app.recordings.items.some(entry=>entry.id===item.id));checks++;
 page.once('dialog',dialog=>dialog.accept());await remove.click();await page.waitForFunction(id=>!document.querySelector(`[data-recorder="delete"][data-id="${id}"]`),item.id);assert.equal(fs.existsSync(file),false);assert.ok(clips.every(clip=>fs.existsSync(clip.file)));checks++;
 await button('start').click();await page.waitForFunction(()=>!document.querySelector('[data-recorder="stop"]').disabled);await production.locator('[data-bumper-skip]').click();await button('stop').click();await page.waitForFunction(()=>!document.querySelector('.recorder-studio [data-bumper-skip]').hidden);await production.locator('[data-bumper-skip]').click();await page.waitForFunction(()=>document.querySelector('.recorder-status').textContent.includes('saved locally'));assert.equal(app.recordings.active.size,0);checks++;
 await button('release').click();await page.waitForFunction(()=>!document.querySelector('.recorder-preview').srcObject);
 for(const phase of ['intro','outro'])await source(phase).selectOption('');
 Object.assign(report,{automaticIntroOutro:true,automaticClipAudioWithoutMainAudio:true,automaticOutroFinalFrame:true,bumperLibraryImport:true,bumperLinkSelection:true,bumperSkip:true,localRecordingDeletion:true,deletionConfirmationCancellation:true});return checks;
}
