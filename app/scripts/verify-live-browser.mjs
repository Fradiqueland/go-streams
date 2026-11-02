// Native Chromium test with synthetic camera/microphone and loopback-only RTMP.
// Uses the browser's debugging protocol; does not access a real camera or publish externally.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createApplication} from '../src/server.mjs';
import {toolsFor,runProcess} from '../src/core.mjs';

const candidates=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'];
const binary=process.env.GO_STREAMS_BROWSER||candidates.find(p=>fs.existsSync(p));
if(!binary)throw Error('Set GO_STREAMS_BROWSER to an installed Chromium browser.');
const parent=path.resolve('.tmp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'live-browser-'));
let app,browser,socket,evaluate,releaseFinalization;const receivers=[],pagesErrors=[],chatPosts=[];let passed=false;
const expectedLiveAspectDimensions=[{aspect:'16:9',width:1280,height:720},{aspect:'9:16',width:720,height:1280},{aspect:'1:1',width:720,height:720},{aspect:'4:3',width:960,height:720},{aspect:'3:4',width:720,height:960},{aspect:'21:9',width:1680,height:720}];
let finalizationGate=null,enteredFinalization=false;
let phase='startup';
const watchdog=setTimeout(()=>{
 console.error(JSON.stringify({testTimedOut:true,phase,jobs:app?.studio.state().jobs,recordings:app?.recordings.state(),receivers:receivers.map(r=>({pid:r.child.pid,exitCode:r.child.exitCode,stderr:r.diagnostics()})),pageErrors:pagesErrors}));
 socket?.close();browser?.kill();for(const receiver of receivers)receiver.child.kill();for(const job of app?.studio.jobs.values()||[])job.child?.kill();process.exit(1);
},120000).unref();
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
try{
 app=await createApplication({directory:path.join(directory,'data'),port:0,portableVault:true,folderPicker:async()=>path.join(directory,'chosen-recordings'),chatOptions:{request:async(url,options)=>{
  let value;if(url.includes('/videos?'))value={items:[{liveStreamingDetails:{activeLiveChatId:'mock-room'}}]};
  else if(options.method==='POST'){chatPosts.push(JSON.parse(options.body));value={id:'mock-reply'};}
  else value={pollingIntervalMillis:30000,nextPageToken:'mock-next',items:[{id:'mock-viewer',authorDetails:{displayName:'Test viewer',channelId:'viewer'},snippet:{displayMessage:'Hello <script>not executable</script>',publishedAt:new Date().toISOString()}}]};
  return new Response(JSON.stringify(value),{status:200});
 }}});
 const executeRecording=app.recordings.execute;app.recordings.execute=async(...args)=>{if(finalizationGate){enteredFinalization=true;await finalizationGate;}return executeRecording(...args);};
 app.studio.chat.auth.data.settings.YouTube={clientId:'123-test.apps.googleusercontent.com'};
 app.studio.chat.auth.data.accounts.YouTube={id:'host',name:'Test host',accessToken:'synthetic-test-token',expires:Date.now()+3600000};
 const {ffmpeg,ffprobe}=toolsFor(app.store.data.settings);
 for(let i=0;i<2;i++){
  const port=await freePort(),url=`rtmp://127.0.0.1:${port}/live`,key=`test-${i}`,output=path.join(directory,`destination-${i}.flv`);
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','warning','-listen','1','-timeout','30','-rw_timeout','15000000','-i',`${url}/${key}`,'-c','copy','-f','flv','-y',output],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-3000);});
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve({code,stderr}));});
  receivers.push({child,done,output,diagnostics:()=>stderr});app.studio.saveChannel({name:`Loopback ${i+1}`,platform:i===0?'YouTube':'Personalizado',url,key});
 }
 browser=spawn(binary,['--headless=new','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${path.join(directory,'browser')}`,'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required','--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const endpoint=await new Promise((resolve,reject)=>{
  let buffer='';const timer=setTimeout(()=>reject(Error('Browser debugging endpoint did not open.')),20000);
  browser.once('error',reject);browser.once('exit',code=>reject(Error(`Browser exited before the test: ${code}`)));
  browser.stderr.on('data',chunk=>{buffer=(buffer+chunk).slice(-5000);const found=/DevTools listening on (ws:\/\/[^\s]+)/.exec(buffer);if(found){clearTimeout(timer);resolve(found[1]);}});
 });
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map();
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')pagesErrors.push(message.params.exceptionDetails.text+': '+(message.params.exceptionDetails.exception?.description||''));});
 const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Browser command timed out: ${method}`));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
 const {targetId}=await command('Target.createTarget',{url:'about:blank'}),{sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
 await command('Page.enable',{},sessionId);
 await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__mediaRequests=[];window.__inputStreams=[];const nativeMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=constraints=>{window.__mediaRequests.push(constraints);return nativeMedia(constraints).then(stream=>{window.__inputStreams.push(stream);return stream;});};`},sessionId);
 await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__screenRequests=[];window.__screenStreams=[];navigator.mediaDevices.getDisplayMedia=async constraints=>{window.__screenRequests.push(constraints);const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d'),draw=()=>{context.fillStyle='#111827';context.fillRect(0,0,640,360);context.fillStyle='#00ff00';context.fillRect(128,128,64,64);};draw();const timer=setInterval(draw,33),stream=canvas.captureStream(30),track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};window.__screenStreams.push(stream);return stream;};`},sessionId);
 await command('Page.addScriptToEvaluateOnNewDocument',{source:`window.__captureTest=[];const NativeRecorder=window.MediaRecorder;window.MediaRecorder=class extends NativeRecorder{constructor(...args){super(...args);const stats={mime:this.mimeType,chunks:0,bytes:0,errors:[]};window.__captureTest.push(stats);this.addEventListener('dataavailable',e=>{stats.chunks++;stats.bytes+=e.data.size;});this.addEventListener('error',e=>stats.errors.push(String(e.error)));}};`},sessionId);
 await command('Page.navigate',{url:app.url+'#capture'},sessionId);
 await command('Runtime.enable',{},sessionId);
 evaluate=async expression=>{
  const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result.value;
 };
 const waitFor=async(expression,timeout=20000)=>{const start=Date.now();while(!await evaluate(expression)){if(Date.now()-start>timeout)throw Error('Browser condition timed out: '+expression);await delay(100);}};
 const formatDisabled=()=>evaluate("['aspect','quality'].every(name=>document.querySelector('#capture-form [name='+name+']').disabled)");
 const setFormat=async(aspect,width,height,quality='720p')=>{
  assert.equal(await evaluate("['aspect','quality'].every(name=>!document.querySelector('#capture-form [name='+name+']').disabled)"),true,'Both format controls must remain editable during a prepared preview');
  await evaluate(`(()=>{for(const [name,value]of [['quality',${JSON.stringify(quality)}],['aspect',${JSON.stringify(aspect)}]]){const input=document.querySelector('#capture-form [name='+name+']');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}})()`);
  await waitFor(`(()=>{const size=document.querySelector('.capture-preview').srcObject.getVideoTracks()[0].getSettings();return size.width===${width}&&size.height===${height};})()`);
  assert.equal(await evaluate("document.querySelector('.capture-frame-size').textContent"),`${width} × ${height}`);
 };
 const verifyPreviewFormats=async()=>{
  await waitFor("['aspect','quality'].every(name=>!document.querySelector('#capture-form [name='+name+']').disabled)");
  const before=await evaluate("({media:window.__mediaRequests.length,screens:window.__screenRequests.length})");
  await evaluate("window.__formatOutput=document.querySelector('.capture-preview').srcObject;window.__formatTrack=window.__formatOutput.getVideoTracks()[0];");
  assert.deepEqual(await evaluate("[...document.querySelector('#capture-form [name=aspect]').options].map(option=>option.value)"),expectedLiveAspectDimensions.map(item=>item.aspect));
  for(const {aspect,width,height}of expectedLiveAspectDimensions){await setFormat(aspect,width,height);assert.equal(await evaluate("document.querySelector('.capture-preview').srcObject===window.__formatOutput&&document.querySelector('.capture-preview').srcObject.getVideoTracks()[0]===window.__formatTrack"),true);}
  await setFormat('3:4',1080,1440,'1080p');
  assert.equal(await evaluate("document.querySelector('.capture-preview').srcObject===window.__formatOutput&&document.querySelector('.capture-preview').srcObject.getVideoTracks()[0]===window.__formatTrack"),true);
  assert.deepEqual(await evaluate("({media:window.__mediaRequests.length,screens:window.__screenRequests.length})"),before);
 };
 await waitFor("Boolean(document.querySelector('[data-capture=preview]'))");
 await evaluate("document.querySelector('[data-capture=preview]').click()");
 await waitFor("Boolean(document.querySelector('.capture-preview').srcObject)");
 phase='preview-ready';console.log(JSON.stringify({phase}));
 assert.equal(await evaluate("document.querySelector('.capture-preview').srcObject.getVideoTracks().length"),1);
 assert.equal(app.studio.jobs.size,0,'Preview must not create a broadcast');
 phase='camera-preview-formats';console.log(JSON.stringify({phase}));await verifyPreviewFormats();await setFormat('1:1',720,720);
 await evaluate("const chat=document.querySelector('.chat-connect');chat.querySelector('[name=resource]').value='abcdefghijk';chat.querySelector('[name=confirmed]').checked=true;chat.querySelector('button').click();");
 await waitFor("document.querySelectorAll('.chat-message').length===1");
 assert.equal(await evaluate("document.querySelectorAll('.chat-messages script').length"),0);
 await evaluate("document.querySelector('.chat-message [data-chat=reply]').click();document.querySelector('.chat-compose textarea').value='Thank you';document.querySelector('.chat-compose button').click();");
 await waitFor("document.querySelectorAll('.chat-own').length===1");assert.equal(chatPosts.length,1);assert.equal(chatPosts[0].snippet.textMessageDetails.messageText,'@Test viewer Thank you');
 phase='chat-ready';console.log(JSON.stringify({phase}));
 await evaluate("const name=document.querySelector('.production-tools [name=name]');name.value='Test presenter';name.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-production=record]').click();");
 await waitFor("!document.querySelector('[data-production=stop-record]').disabled");
 assert.equal(await formatDisabled(),true,'Starting local recording must lock the shared frame geometry');
 phase='local-recording-started';console.log(JSON.stringify({phase}));
 await evaluate("document.querySelectorAll('.capture-destinations input').forEach(el=>{el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));});const consent=document.querySelector('[data-capture=consent]');consent.checked=true;consent.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-capture=start]').click();");
 phase='waiting-live-frames';console.log(JSON.stringify({phase}));
 const started=Date.now();while(![...app.studio.jobs.values()].filter(j=>j.status==='running').length||[...app.studio.jobs.values()].some(j=>j.elapsed<.25)){
  if(Date.now()-started>30000){const diagnostics={jobs:app.studio.state().jobs,renderer:await evaluate('window.__captureTest'),pageErrors:pagesErrors,liveInputs:[...app.studio.liveCapture.sessions.values()].map(s=>({sequence:s.sequence,age:Date.now()-s.lastInput})),recordings:app.recordings.state()};throw Error('Live destinations did not receive frames: '+JSON.stringify(diagnostics));}await delay(200);
 }
 assert.equal(app.studio.jobs.size,2);
 assert.equal(await formatDisabled(),true,'Live destinations must retain the shared frame geometry');
 assert.equal(await evaluate('window.__captureTest.length'),1,'Recording and live output must share one browser encoder');
 phase='live-frames-received';console.log(JSON.stringify({phase}));
 await evaluate("document.querySelector('[data-production=stop-record]').click()");
 await waitFor("document.querySelector('.recording-status').textContent.includes('saved locally')",30000);
 assert.ok([...app.studio.jobs.values()].every(j=>!j.ended),'Stopping recording must preserve live destinations');
 assert.equal(await formatDisabled(),true,'Stopping local recording cannot resize the feed still used by live destinations');
 await evaluate("document.querySelector('[data-production=record]').click()");
 await waitFor("!document.querySelector('[data-production=stop-record]').disabled");await delay(4000);
 await evaluate("location.hash='live'");await waitFor("document.querySelectorAll('.job').length===2");
 assert.equal(await evaluate("document.querySelectorAll('[data-action=pause-job],[data-action=restart-job],[data-action=job-settings]').length"),0);
 await evaluate("location.hash='capture'");await waitFor("Boolean(document.querySelector('.capture-preview')?.srcObject)");
 await evaluate("document.querySelector('[data-capture=stop]').click()");
 await waitFor("!document.querySelector('[data-capture=release]').disabled");
 phase='live-stopped';console.log(JSON.stringify({phase}));
 await Promise.all([...app.studio.jobs.values()].map(j=>j.completion));
 assert.ok([...app.studio.jobs.values()].every(j=>j.status==='stopped'));
 assert.equal(app.recordings.active.size,1,'Stopping live destinations must not discard local recording');
 assert.equal(await formatDisabled(),true,'A remaining local recording must keep its frame geometry');
 finalizationGate=new Promise(resolve=>{releaseFinalization=resolve;});enteredFinalization=false;
 await evaluate("document.querySelector('[data-production=stop-record]').click()");
 const finalizationDeadline=Date.now()+10000;while(!enteredFinalization){if(Date.now()>finalizationDeadline)throw Error('Local recording did not enter finalization.');await delay(25);}
 assert.equal(await formatDisabled(),true,'Geometry must remain locked while the recording is being finalized');
 await evaluate("(()=>{for(const [name,value]of [['aspect','3:4'],['quality','1080p']]){const input=document.querySelector('#capture-form [name='+name+']');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));}})()");
 assert.deepEqual(await evaluate("({aspect:document.querySelector('#capture-form [name=aspect]').value,quality:document.querySelector('#capture-form [name=quality]').value,width:document.querySelector('.capture-preview').srcObject.getVideoTracks()[0].getSettings().width,height:document.querySelector('.capture-preview').srcObject.getVideoTracks()[0].getSettings().height})"),{aspect:'1:1',quality:'720p',width:720,height:720});
 finalizationGate=null;releaseFinalization();releaseFinalization=null;
 await waitFor("document.querySelector('.recording-status').textContent.includes('saved locally')",30000);
 await waitFor("['aspect','quality'].every(name=>!document.querySelector('#capture-form [name='+name+']').disabled)");
 phase='recording-saved';console.log(JSON.stringify({phase}));
 assert.equal(app.recordings.state()[0].status,'completed');
 phase='validating-recording';console.log(JSON.stringify({phase}));
 for(const [index,recording]of app.recordings.state().entries()){
  const localMedia=JSON.parse((await runProcess(ffprobe,['-v','error','-show_format','-show_streams','-of','json',app.recordings.media(recording.id)])).stdout),video=localMedia.streams.find(stream=>stream.codec_type==='video');
  assert.equal(video.codec_name,'h264');assert.deepEqual([video.width,video.height],[720,720]);if(index===0)assert.ok(Number(localMedia.format.duration)>1);
 }
 await setFormat('3:4',720,960);assert.equal(await evaluate("document.querySelector('.capture-preview').srcObject===window.__formatOutput"),true);
 phase='releasing-preview';console.log(JSON.stringify({phase}));
 await evaluate("document.querySelector('[data-capture=release]').click()");await waitFor("!document.querySelector('.capture-preview').srcObject");
 for(const [index,receiver]of receivers.entries()){
  phase=`validating-destination-${index+1}`;console.log(JSON.stringify({phase}));
  let timer;try{await Promise.race([receiver.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`RTMP test receiver did not close: ${receiver.diagnostics()}`)),25000);})]);}finally{clearTimeout(timer);}
  const {stdout}=await runProcess(ffprobe,['-v','error','-count_packets','-show_streams','-of','json',receiver.output]);const streams=JSON.parse(stdout).streams;assert.equal(streams.find(s=>s.codec_type==='video').codec_name,'h264');assert.deepEqual([streams.find(s=>s.codec_type==='video').width,streams.find(s=>s.codec_type==='video').height],[720,720]);assert.ok(Number(streams.find(s=>s.codec_type==='video').nb_read_packets)>10);assert.equal(streams.find(s=>s.codec_type==='audio').codec_name,'aac');
 }
 phase='screen-preview-formats';console.log(JSON.stringify({phase}));
 const mediaRequestsBeforeScreen=await evaluate('window.__mediaRequests.length');
 await evaluate("(()=>{const source=document.querySelector('#capture-form [name=source]');source.value='screen';source.dispatchEvent(new Event('change',{bubbles:true}));for(const name of ['useMic','systemAudio'])document.querySelector('#capture-form [name='+name+']').checked=false;document.querySelector('[data-capture=preview]').click();})()");
 await waitFor("Boolean(document.querySelector('.capture-preview').srcObject)");assert.equal(await evaluate('window.__screenRequests.length'),1);assert.equal(await evaluate('window.__mediaRequests.length'),mediaRequestsBeforeScreen);
 await verifyPreviewFormats();await setFormat('16:9',1280,720);
 await evaluate("document.querySelector('[data-capture=release]').click()");await waitFor("!document.querySelector('.capture-preview').srcObject");assert.equal(await evaluate('window.__screenStreams.every(stream=>stream.getTracks().every(track=>track.readyState==="ended"))'),true);
 phase='microphone-only-preview';console.log(JSON.stringify({phase}));
 assert.equal(await evaluate('window.__inputStreams.every(stream=>stream.getVideoTracks().every(track=>track.readyState==="ended"))'),true);
 await evaluate('window.__mediaRequests=[];const source=document.querySelector("#capture-form [name=source]");source.value="microphone";source.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("[data-capture=preview]").click();');
 await waitFor("Boolean(document.querySelector('.capture-preview').srcObject)");
 const requests=await evaluate('window.__mediaRequests');assert.equal(requests.length,1);assert.equal(requests[0].video,false);assert.ok(requests[0].audio);
 assert.equal(await evaluate('window.__inputStreams.at(-1).getVideoTracks().length'),0);
  await evaluate("document.querySelector('[data-production=record]').click()");await waitFor("!document.querySelector('[data-production=stop-record]').disabled");
  // Wait for the shared encoder's first keyframe and real bytes, rather than
  // stopping a short recording before a loaded runner has produced its output.
  const audioDeadline=Date.now()+25000;
  while(!app.recordings.state().some(item=>item.status==='recording'&&item.bytes>=32768)){
   if(Date.now()>audioDeadline)throw Error('Microphone-only recording did not receive encoded media.');
   await delay(100);
  }
  await delay(2000);
 await evaluate("document.querySelector('[data-production=stop-record]').click()");await waitFor("document.querySelector('.recording-status').textContent.includes('saved locally')",30000);
 assert.equal(app.recordings.state().length,3);assert.ok(app.recordings.state().every(item=>item.status==='completed'&&item.directory===fs.realpathSync(path.join(directory,'chosen-recordings'))));
 const audioOnly=JSON.parse((await runProcess(ffprobe,['-v','error','-show_streams','-of','json',app.recordings.media(app.recordings.state()[0].id)])).stdout).streams;assert.equal(audioOnly.find(s=>s.codec_type==='audio').codec_name,'aac');assert.equal(audioOnly.find(s=>s.codec_type==='video').codec_name,'h264');
 await evaluate("document.querySelector('[data-capture=release]').click()");await waitFor("!document.querySelector('.capture-preview').srcObject");
 assert.deepEqual(pagesErrors,[]);passed=true;
 const proof={passed:true,platform:process.platform,syntheticCameraAndMicrophone:true,destinations:2,nativeRTMP:true,previewDoesNotBroadcast:true,previewSurvivesNavigation:true,stopAndRelease:true,localRecording:true,sharedCaptureEncoder:true,independentRecordStartStop:true,cloudRecording:false,unifiedChatWithSimulatedProvider:true,realChatAccountsVerified:false,realHardwareVerified:false,nativeScreenPickerVerified:false,microphoneOnlyWithoutCamera:true,recordingsWrittenToChosenFolder:true,liveAspectFormats:true,previewFormatWithoutReacquisition:true,expectedLiveAspectDimensions,screenPreviewFormats:true,liveRecordingDimensions:[720,720],liveFormatLockedDuringOutputs:true,liveFormatLockedDuringFinalization:true,liveFormatUnlockedAfterStop:true};
 const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;fs.mkdirSync('release',{recursive:true});fs.writeFileSync(`release/GoStreams-${version}-live-studio-${process.platform}-verification.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
 await command('Browser.close').catch(()=>{});
 }catch(error){
  const recordingEvidence=app?.recordings.state().map(({status,bytes,error})=>({status,bytes,error}));
  let interfaceEvidence;try{interfaceEvidence=await evaluate("({recording:document.querySelector('.recording-status')?.textContent,capture:document.querySelector('.capture-status')?.textContent,toast:document.querySelector('#toast')?.textContent})");}catch{}
  console.error(JSON.stringify({phase,recordingEvidence,interfaceEvidence,pageErrors:pagesErrors}));
  throw error;
 }finally{
 phase='cleanup';
 releaseFinalization?.();finalizationGate=null;
 socket?.close();if(browser&&browser.exitCode===null)browser.kill();
 await app?.close();for(const r of receivers)if(r.child.exitCode===null)r.child.kill();await Promise.allSettled(receivers.map(r=>r.done));
 if(!passed)console.error('Browser test evidence directory: '+directory);
 clearTimeout(watchdog);
}
