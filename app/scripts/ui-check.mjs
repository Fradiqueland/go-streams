import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApplication } from '../src/server.mjs';
import { dispatch } from '../test/transport.mjs';
import { runProcess } from '../src/core.mjs';
const runtimePackage = process.env.GO_STREAMS_PLAYWRIGHT_PACKAGE;
if (!runtimePackage) throw Error('Defina GO_STREAMS_PLAYWRIGHT_PACKAGE para um package.json com Playwright instalado.');
const { chromium } = createRequire(runtimePackage)('playwright');
const browserCandidates=process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'];
const browserPath=process.env.GO_STREAMS_BROWSER||browserCandidates.find(p=>fs.existsSync(p));
if(!browserPath)throw Error('Configure GO_STREAMS_BROWSER com um navegador Chromium instalado.');
const base = path.resolve(process.env.GO_STREAMS_UI_OUTPUT||'.tmp/ui-check'); fs.mkdirSync(base, { recursive: true });
const directory = fs.mkdtempSync(path.join(base, 'data-'));
const clip = path.join(directory, 'Ensaio de emissão.mp4');
await runProcess('ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-y',clip]);
const app = await createApplication({ directory, port: 4317, listen: false, clock: false });
let context;
const version=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const started=new Date().toISOString(),screenshots=[];let passed=false,failure='';
let checks = 0; const errors = [];
try {
  context = await chromium.launchPersistentContext(path.join(directory, 'browser'), { executablePath: browserPath, headless: true, chromiumSandbox: true, viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'go_streams', value: app.token, url: app.base, httpOnly: true, sameSite: 'Strict' }]);
  await context.route('**/*', async route => {
    const request = route.request();
    if (!request.url().startsWith(app.base + '/')) return route.abort();
    const response = await dispatch(app, request.url(), { method: request.method(), headers: await request.allHeaders(), body: request.postData() });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: response.body });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  async function capture(file,section='dashboard'){
    await page.screenshot({path:path.join(base,file),fullPage:true});
    screenshots.push({file,section,viewport:page.viewportSize()});
  }
  const navigation=page.getByRole('navigation',{name:'Menu principal'});
  async function goTo(name){
    await navigation.getByRole('link',{name,exact:true}).click();
    await page.waitForFunction(expected=>document.querySelector('#crumb')?.textContent===expected,name);
  }

  await page.goto(app.base + '/');
  await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
  assert.equal(await page.locator('#language-select').inputValue(),'en');
  assert.equal(await page.locator('#language-select option').count(),10);
  assert.ok(await page.locator('.nav-item').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
  assert.ok(await page.locator('[data-action=go-live]').first().evaluate(el=>el.getBoundingClientRect().height>=44));checks++;
  const products=page.locator('.creator-credit a');assert.equal(await products.getAttribute('href'),'https://AntonioFradique.net');assert.equal(await products.getAttribute('target'),'_blank');checks++;
  for(const [code,title,dir] of [['es','Resumen','ltr'],['fr','Vue d’ensemble','ltr'],['hi','अवलोकन','ltr'],['ar','نظرة عامة','rtl'],['zh','概览','ltr'],['bn','সারসংক্ষেপ','ltr'],['ru','Обзор','ltr'],['id','Ringkasan','ltr'],['pt-PT','Visão geral','ltr']]){
    await page.locator('#language-select').selectOption(code);
    await page.getByRole('heading',{name:title,exact:true}).waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'),dir);
    assert.equal(await page.locator('#language-select').inputValue(),code);checks++;
  }
  await page.reload();await page.getByRole('heading',{name:'Visão geral',exact:true}).waitFor();checks++;

  assert.equal(await page.locator('header').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(225, 10, 81)');checks++;
  await capture('dashboard-empty.png');
  await goTo('Biblioteca de vídeos');
  assert.equal(await page.locator('#content [data-action="import-link"]').count(),0);
  await page.locator('[data-action="import"]').first().click();
  await page.locator('#modal-form [data-action="import-link"]').click();
  await page.getByLabel('Ligações dos vídeos (uma por linha)',{exact:true}).fill('https://example.test/playlist.m3u8');
  await page.locator('#modal-form').getByRole('button',{name:'Adicionar por ligação',exact:true}).click();
  await page.locator('#modal-form .form-error').waitFor({state:'visible'});
  assert.equal(app.store.data.media.length,0);
  await page.getByRole('button',{name:'Fechar',exact:true}).click();checks++;
  await page.locator('[data-action="import"]').first().click();
  await page.getByLabel('Caminhos locais').fill(clip);
  await page.locator('#modal-form').getByRole('button', { name: 'Importar vídeos', exact: true }).click();
  await page.locator('#dialog').waitFor({ state: 'hidden' });
  await page.locator('.media-table').getByText('Ensaio de emissão',{exact:true}).waitFor(); checks++;
  await goTo('Canais');
  await page.locator('[data-action="channel-new"]').first().click();
  await page.getByLabel('Nome do canal').fill('Canal de ensaio');
  await page.getByLabel('Servidor RTMP / RTMPS').fill('rtmp://127.0.0.1:9/live');
  await page.getByLabel('Chave de transmissão').fill('LOCAL-UI-TEST-SECRET');
  await page.locator('#modal-form').getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.locator('#dialog').waitFor({ state: 'hidden' });
  assert.ok(!(await page.content()).includes('LOCAL-UI-TEST-SECRET')); checks++;
  await goTo('Playlists');
  await page.locator('[data-action="playlist-new"]').first().click();
  await page.getByLabel('Nome', { exact: true }).fill('Programação de ensaio');
  await page.locator('#add-media-button').click();
  await page.locator('#add-media-button').click();
  await page.getByRole('button', { name: 'Subir vídeo' }).nth(1).click();
  await page.locator('#modal-form').getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.locator('#dialog').waitFor({ state: 'hidden' }); checks++;
  await page.locator('[data-action=playlist-rename]').first().click();
  assert.equal(await page.locator('.dialog-head').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(231, 9, 82)');
  await page.locator('#modal-form input[name=name]').fill('Programa de ensaio renomeado');
  await page.locator('#modal-form').getByRole('button',{name:'Guardar',exact:true}).click();
  await page.locator('#dialog').waitFor({state:'hidden'});
  assert.equal(app.store.data.playlists[0].name,'Programa de ensaio renomeado');checks++;
  await page.locator('[data-action=preview-playlist]').first().click();
  await page.getByRole('button', { name: 'Ver resultado', exact: true }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Ver resultado', exact: true }).click();
  await page.locator('video').waitFor();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click(); checks++;
  await goTo('Agendamento');
  await page.locator('[data-action="schedule-new"]').first().click();
  await page.locator('#source-mode').selectOption('playlist');
  await page.getByLabel('Canal de ensaio').check();
  await page.getByLabel('Confirmo os canais e o horário selecionados.').check();
  await page.getByRole('button', { name: 'Guardar agendamento', exact: true }).click();
  await page.locator('#dialog').waitFor({ state: 'hidden' });
  await page.getByText('Pausado', { exact: true }).waitFor(); checks++;
  await goTo('Entrar em direto');
  await page.locator('[data-action="plan-channel"]').first().click();
  assert.equal(await page.locator('#modal-form [name=confirmed]').count(),0);checks++;
  await page.locator('#source-mode').selectOption('video');
  await page.locator('[name=countdown]').selectOption('30');
  await page.getByRole('button',{name:'Guardar preparação',exact:true}).click();
  await page.locator('#dialog').waitFor({state:'hidden'});
  assert.equal(app.studio.jobs.size,1); // Only the completed local preview exists.
  await page.locator('[data-action="plan-schedule"]').first().click();
  await page.getByLabel('Confirmo os canais e o horário selecionados.').check();
  await page.getByRole('button',{name:'Guardar agendamento',exact:true}).click();
  await page.locator('#dialog').waitFor({state:'hidden'});
  assert.equal(app.store.data.schedules.length,2);checks++;
  await goTo('Definições');
  await page.locator('#notification-form [name=host]').fill('smtp.unsaved.example');
  await page.locator('#encoding-form [name=videoBitrate]').selectOption('1000');
  await page.getByRole('button',{name:'Guardar perfil',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Definições guardadas.');
  assert.equal(await page.locator('#notification-form [name=host]').inputValue(),'smtp.unsaved.example');
  assert.equal(app.store.data.settings.encoding.videoBitrate,1000);checks++;
  await page.locator('#encoding-form [name=copy]').check();
  assert.equal(await page.locator('#encoding-form [name=videoBitrate]').isDisabled(),true);
  await page.getByRole('button',{name:'Guardar perfil',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#encoding-form button').disabled);
  assert.equal(app.store.data.settings.encoding.copy,true);
  assert.equal(app.store.data.settings.encoding.videoBitrate,1000);
  await page.locator('#encoding-form [name=copy]').uncheck();
  assert.equal(await page.locator('#encoding-form [name=videoBitrate]').isEnabled(),true);
  await page.getByRole('button',{name:'Guardar perfil',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#encoding-form button').disabled);
  assert.equal(app.store.data.settings.encoding.copy,false);checks++;
  await page.locator('#operation-form [name=maxConcurrent]').fill('12');
  await page.locator('#operation-form [name=historyLimit]').selectOption('5000');
  await page.locator('#operation-form [name=persistSchedules]').check();
  await page.getByRole('button',{name:'Guardar operação',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#operation-form button').disabled);
  assert.deepEqual(app.store.data.settings.operations,{maxConcurrent:12,historyLimit:5000,persistSchedules:true});
  assert.equal(await page.locator('#notification-form [name=host]').inputValue(),'smtp.unsaved.example');checks++;
  await page.locator('#notification-form [name=security]').selectOption('tls');
  await page.locator('#notification-form [name=port]').fill('465');
  await page.locator('#notification-form [name=enabled]').uncheck();
  await page.getByRole('button',{name:'Guardar notificações',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#notification-form button.primary').disabled);
  assert.equal(app.store.data.notifications.security,'tls');
  assert.equal(app.store.data.notifications.port,465);
  assert.equal(app.store.data.notifications.enabled,false);checks++;
  await page.getByRole('button',{name:'Recolher menu',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('data-compact-nav'),'true');
  await goTo('Ajuda');
  await page.getByRole('button',{name:'Expandir menu',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('data-compact-nav'),'false');checks++;
  await goTo('Playlists');
  await page.locator('[data-action=playlist-edit]').first().click();
  while(await page.locator('[data-remove]').count())await page.locator('[data-remove]').first().click();
  await page.locator('#modal-form').getByRole('button',{name:'Guardar',exact:true}).click();
  await page.locator('#modal-form .form-error').waitFor({state:'visible'});
  assert.equal(app.store.data.playlists[0].mediaIds.length,2);
  await page.getByRole('button',{name:'Fechar',exact:true}).click();checks++;
  await page.getByRole('textbox',{name:'Pesquisar playlists',exact:true}).fill('No matching playlist');
  await page.getByRole('heading',{name:'Nenhuma playlist encontrada',exact:true}).waitFor();checks++;
  for (const name of ['Entrar em direto','Em direto agora','Ferramentas', 'Histórico', 'Definições', 'Ajuda','Visão geral']) { await goTo(name); checks++; }
  await goTo('Ferramentas');
  const downloader=app.downloads.spawn;
  try{
    app.downloads.spawn=()=>{throw Error('Controlled unavailable downloader; no network request');};
    await page.locator('[data-action="download-new"]').click();
    await page.locator('#modal-form [name=url]').fill('https://youtu.be/abcdefghijk');
    await page.locator('#modal-form').getByRole('button',{name:'Descarregar',exact:true}).click();
    await page.locator('#dialog').waitFor({state:'hidden'});
    await page.locator('[data-action="retry-download"]').waitFor();
    assert.equal(app.store.data.downloads[0].status,'error');checks++;
    await page.locator('[data-action="retry-download"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-action="retry-download"]').length===2);
    assert.ok(app.store.data.downloads.every(d=>d.addToLibrary===false));checks++;
    for(const remaining of [1,0]){
      await page.locator('[data-action="remove-download"]').first().click();
      await page.waitForFunction(n=>document.querySelectorAll('[data-action="remove-download"]').length===n,remaining);
    }
    assert.equal(app.store.data.downloads.length,0);checks++;
  }finally{app.downloads.spawn=downloader;}
  await goTo('Definições');
  const overlayLogo=path.join(directory,'overlay-logo.png');
  await runProcess('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=32x32','-frames:v','1','-y',overlayLogo]);
  await page.locator('[data-action="overlays"]').click();
  await page.locator('[name=topEnabled]').check();await page.locator('[name=topText]').fill('António 🎵 Música 24/7');
  await page.locator('[name=bottomEnabled]').check();await page.locator('[name=bottomText]').fill('Obrigado ❤️');
  await page.locator('[name=imageEnabled]').check();await page.locator('[name=overlayImage]').setInputFiles(overlayLogo);
  await page.locator('[data-overlay-preview] img').waitFor();assert.equal(await page.locator('.overlay-bar').count(),2);
  const overlaySizes=await page.locator('[data-overlay-preview]').evaluate(el=>({width:el.clientWidth,image:el.querySelector('img').getBoundingClientRect().width,bar:el.querySelector('.overlay-bar').getBoundingClientRect().height}));assert.ok(Math.abs(overlaySizes.image-overlaySizes.width*.15)<3);assert.ok(overlaySizes.bar>10);checks++;
  await capture('overlay-editor-1440.png','overlays');
  await page.setViewportSize({width:390,height:1000});
  assert.ok(await page.locator('#dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));checks++;
  await capture('overlay-editor-390.png','overlays');await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Guardar sobreposições',exact:true}).click();await page.locator('#dialog').waitFor({state:'hidden'});
  assert.equal(app.store.data.settings.overlays.top.text,'António 🎵 Música 24/7');assert.ok(!JSON.stringify(app.store.data.settings.overlays).includes('base64'));checks++;
  await page.locator('[data-action="overlays"]').click();assert.equal(await page.locator('[name=topText]').inputValue(),'António 🎵 Música 24/7');checks++;
  for(const name of ['topEnabled','bottomEnabled','imageEnabled'])await page.locator('[name='+name+']').uncheck();
  await page.getByRole('button',{name:'Guardar sobreposições',exact:true}).click();await page.locator('#dialog').waitFor({state:'hidden'});
  assert.ok(['top','bottom','image'].every(key=>!app.store.data.settings.overlays[key].enabled));checks++;
  await goTo('Visão geral');
  await capture('dashboard-populated.png');
  for(const width of [1440,800,390]){
    await page.setViewportSize({width,height:1000});
    for(const name of ['Visão geral','Entrar em direto','Em direto agora','Biblioteca de vídeos','Canais','Playlists','Agendamento','Ferramentas','Histórico','Definições','Ajuda']){
      await goTo(name);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${name}: horizontal page overflow at ${width}px`);checks++;
      const section=await page.evaluate(()=>location.hash.slice(1)||'dashboard');
      await capture(`screen-${width}-${section}.png`,section);
    }
    await goTo('Visão geral');
    await capture(`dashboard-${width}.png`);
  }
  const blockedPage=await context.newPage();blockedPage.on('pageerror',e=>errors.push(e.message));
  try{
    await blockedPage.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError');}});});
    await blockedPage.goto(app.base+'/');
    await blockedPage.getByRole('heading',{name:'Overview',exact:true}).waitFor();
    assert.ok((await blockedPage.locator('#content').textContent()).includes('CHANNELS'));checks++;
    await blockedPage.locator('nav a[href="#media"]').click();
    await blockedPage.locator('[data-action="media-grid"]').click();
    await blockedPage.locator('[data-action="media-grid"].selected').waitFor();
    assert.equal(await blockedPage.locator('#toast').textContent(),'This preference applies to this session only.');checks++;
    await blockedPage.locator('[data-action="media-list"]').click();
    await blockedPage.locator('[data-action="media-list"].selected').waitFor();checks++;
  }finally{await blockedPage.close();}
  assert.deepEqual(errors, []);
  passed=true;
  console.log(JSON.stringify({ version, checks, pageErrors: errors, screenshots: base, transport: 'Production HTTP handler via Playwright route; no network sockets', vault: process.platform==='win32'?'Windows DPAPI':'Chave local privada' }));
} catch(error){failure=String(error.message||error).split('\n')[0].slice(0,500);throw error;}
finally {
  const cleanup=[];
  for(const close of [()=>context?.close(),()=>app.close()])try{await close();}catch(error){cleanup.push(error);}
  const report={version,started,finished:new Date().toISOString(),passed:passed&&!cleanup.length,checks,pageErrors:errors,failure:failure||(cleanup.length?'Falha ao terminar a verificação.':''),screenshots,transport:'Production HTTP handler via Playwright route; no network sockets'};
  fs.writeFileSync(path.join(base,'result.json'),JSON.stringify(report,null,2));
  if(cleanup.length)throw new AggregateError(cleanup,'Falha ao terminar a verificação.');
}
