// Exercises production playout and FFmpeg continuously; output stays in an offline null sink.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appRoot=process.env.GO_STREAMS_APP_ROOT||root;
const {createApplication}=await import(pathToFileURL(path.join(appRoot,'src/server.mjs')).href);
const {runProcess,toolsFor}=await import(pathToFileURL(path.join(appRoot,'src/core.mjs')).href);
const args=process.argv.slice(2);
function option(name,fallback){const i=args.indexOf(name);return i<0?fallback:Number(args[i+1]);}
const seconds=option('--seconds',60),streams=option('--streams',7);
if(!Number.isSafeInteger(seconds)||seconds<10||seconds>259200||!Number.isSafeInteger(streams)||streams<1||streams>32)throw Error('Use --seconds 10..259200 e --streams 1..32.');
const parent=path.join(root,'.tmp');fs.mkdirSync(parent,{recursive:true});
const directory=fs.mkdtempSync(path.join(parent,'soak-')),clip=path.join(directory,'clip.mp4');
let app,aborted=false;const sample=[];const stop=()=>{aborted=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const started=Date.now();
try{
 await runProcess(toolsFor({}).ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',clip]);
 app=await createApplication({directory:path.join(directory,'data'),listen:false,clock:false,portableVault:true});
 app.store.update(s=>{s.settings.operations={maxConcurrent:0,historyLimit:500,persistSchedules:false};s.settings.encoding={copy:true,videoBitrate:2500,audioBitrate:128,fps:30,aspect:'16:9'};});
 app.studio.spawnProcess=(command,argv,options)=>{
   if(!/^rtmp:\/\/127\.0\.0\.1:9\/live\/LOCAL-[0-9]+$/.test(argv.at(-1)) || argv.at(-2)!=='flv')throw Error('Unexpected target; refusing to run.');
   return spawn(command,[...argv.slice(0,-3),'-f','null','-'],options);
 };
 const imported=await app.studio.importMedia([clip]);
 const mediaId=app.store.data.media[0].id;
 const playlistId=app.studio.savePlaylist({name:'Offline endurance',mediaIds:[mediaId,mediaId],loop:true});
 const channelIds=Array.from({length:streams},(_,i)=>app.studio.saveChannel({name:'Offline '+i,url:'rtmp://127.0.0.1:9/live',key:'LOCAL-'+i}));
 const jobs=await app.studio.start({playlistId,channelIds,confirmed:true});
 const deadline=Date.now()+seconds*1000;
 while(Date.now()<deadline&&!aborted){
   await new Promise(r=>setTimeout(r,1000));
   const live=jobs.map(j=>app.studio.jobs.get(j.id));
   if(live.some(j=>j.ended))throw Error('A playout process ended unexpectedly.');
   if(sample.length===0||Date.now()-sample.at(-1).at>=10000){
     const entry={at:Date.now(),elapsed:Math.min(...live.map(j=>j.elapsed)),rss:process.memoryUsage().rss,streams:live.length};sample.push(entry);console.log(JSON.stringify(entry));
   }
 }
 if(aborted)throw Error('Endurance check interrupted.');
 const live=jobs.map(j=>app.studio.jobs.get(j.id));
 if(live.some(j=>j.status!=='running'||j.elapsed<seconds-5))throw Error('One or more streams stopped making progress.');
 for(const j of live)app.studio.stop(j.id);await Promise.all(live.map(j=>j.completion));
 const report={ok:true,seconds,streams,wallSeconds:(Date.now()-started)/1000,minimumPlayoutSeconds:Math.min(...live.map(j=>j.elapsed)),transport:'FFmpeg offline null sink; no network or platform transmission',samples:sample};
 const target=path.join(parent,'soak-result.json');fs.writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,report:target,seconds,streams}));
}finally{
 process.off('SIGINT',stop);process.off('SIGTERM',stop);await app?.close();
 if(!directory.startsWith(parent+path.sep)||!path.basename(directory).startsWith('soak-'))throw Error('Unsafe cleanup');fs.rmSync(directory,{recursive:true,force:true});
}
