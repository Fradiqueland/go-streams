import {tr} from './i18n.js';
const defaults={enabled:false,text:'',fontSize:32,speed:100,direction:'left',color:'#ffffff',background:'#000000',opacity:.65,asset:''};
export function overlayEditor(config={},esc){
 const banner=key=>{const b={...defaults,...config[key]};return `<fieldset><legend>${tr(key==='top'?'Banner superior':'Banner inferior')}</legend><label class="check"><input type="checkbox" name="${key}Enabled" ${b.enabled?'checked':''}> ${tr('Ativar')}</label><label>${tr('Texto e emojis')}<input name="${key}Text" value="${esc(b.text)}" maxlength="500" placeholder="🎵 Antonio Fradique • Música 24/7"></label><div class="form-row"><label>${tr('Tamanho do texto')}<input type="number" name="${key}Font" min="16" max="64" value="${b.fontSize}" required></label><label>${tr('Velocidade')}<input type="number" name="${key}Speed" min="20" max="300" value="${b.speed}" required></label><label>${tr('Direção')}<select name="${key}Direction"><option value="left" ${b.direction==='left'?'selected':''}>←</option><option value="right" ${b.direction==='right'?'selected':''}>→</option></select></label></div><div class="form-row"><label>${tr('Cor do texto')}<input type="color" name="${key}Color" value="${b.color}"></label><label>${tr('Cor do fundo')}<input type="color" name="${key}Background" value="${b.background}"></label><label>${tr('Opacidade do fundo')}<input type="number" name="${key}Opacity" min="0" max="1" step="0.05" value="${b.opacity}" required></label></div></fieldset>`;};
 const i={enabled:false,asset:'',width:15,x:95,y:15,opacity:1,...config.image};
 return `<div class="overlay-editor"><p class="form-hint">${tr('Aplica-se às próximas emissões e testes locais. Os vídeos originais não são alterados. Sobreposições ativam a recodificação.')}</p><div class="overlay-preview" data-overlay-preview aria-label="${tr('Pré-visualização aproximada')}"></div>${banner('top')}${banner('bottom')}<fieldset><legend>${tr('Imagem sobreposta')}</legend><label class="check"><input type="checkbox" name="imageEnabled" ${i.enabled?'checked':''}> ${tr('Ativar')}</label><label>${tr('Imagem PNG, JPG, GIF ou WebP (até 2 MB)')}<input name="overlayImage" type="file" accept="image/png,image/jpeg,image/gif,image/webp"></label>${i.asset?`<small>${tr('Imagem guardada. Escolha outra apenas para substituir.')}</small>`:''}<div class="form-row"><label>${tr('Largura (%)')}<input name="imageWidth" type="number" min="5" max="60" value="${i.width}" required></label><label>${tr('Posição horizontal (%)')}<input name="imageX" type="number" min="0" max="100" value="${i.x}" required></label><label>${tr('Posição vertical (%)')}<input name="imageY" type="number" min="0" max="100" value="${i.y}" required></label></div><label>${tr('Opacidade da imagem')}<input name="imageOpacity" type="number" min="0.05" max="1" step="0.05" value="${i.opacity}" required></label></fieldset></div>`;
}
export function overlayValues(form,previous={}){
 const config={};for(const k of ['top','bottom'])config[k]={enabled:form.has(k+'Enabled'),text:String(form.get(k+'Text')||''),fontSize:Number(form.get(k+'Font')),speed:Number(form.get(k+'Speed')),direction:form.get(k+'Direction'),color:form.get(k+'Color'),background:form.get(k+'Background'),opacity:Number(form.get(k+'Opacity')),asset:previous[k]?.asset||''};
 config.image={enabled:form.has('imageEnabled'),asset:previous.image?.asset||'',width:Number(form.get('imageWidth')),x:Number(form.get('imageX')),y:Number(form.get('imageY')),opacity:Number(form.get('imageOpacity'))};return config;
}
export async function renderBanner(b){
 await document.fonts?.ready;const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 const font=`bold ${b.fontSize}px Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;ctx.font=font;
 const width=Math.ceil(ctx.measureText(b.text).width)+48;if(width>32768)throw Error(tr('Texto demasiado largo. Reduza o texto ou o tamanho das letras.'));
 canvas.width=Math.max(2,width);canvas.height=b.fontSize+24;ctx.font=font;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle=b.color;ctx.fillText(b.text,24,canvas.height/2);
 const data=canvas.toDataURL('image/png');if(data.length>700000)throw Error(tr('O banner é demasiado grande. Reduza o texto.'));return data;
}
export async function imageData(file){
 if(file.size>2*1024*1024||!['image/png','image/jpeg','image/gif','image/webp'].includes(file.type))throw Error(tr('Escolha uma imagem PNG, JPG, GIF ou WebP até 2 MB.'));
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(tr('Não foi possível ler a imagem.')));reader.readAsDataURL(file);});
 await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth<=4096&&img.naturalHeight<=4096?resolve():reject(Error(tr('A imagem deve ter no máximo 4096 × 4096 píxeis.')));img.onerror=()=>reject(Error(tr('Imagem inválida.')));img.src=data;});return data;
}
export function overlayPreview(config,image,esc){
 let html=image&&config.image.enabled?`<img alt="" src="${esc(image)}">`:'';
 for(const key of ['top','bottom']){const b=config[key];if(!b.enabled)continue;html+=`<div class="overlay-bar ${key}"><span>${esc(b.text)}</span></div>`;}
 return html;
}
// Use CSS properties rather than inline markup, keeping the existing strict CSP.
export function styleOverlayPreview(element,config){
 const image=element.querySelector('img');if(image){const i=config.image;Object.assign(image.style,{width:i.width+'%',left:i.x+'%',top:i.y+'%',transform:`translate(-${i.x}%,-${i.y}%)`,opacity:String(i.opacity)});}
 for(const key of ['top','bottom']){const bar=element.querySelector('.overlay-bar.'+key);if(!bar)continue;const b=config[key];Object.assign(bar.style,{height:(b.fontSize+24)/7.2+'%',background:b.background+Math.round(b.opacity*255).toString(16).padStart(2,'0')});Object.assign(bar.querySelector('span').style,{fontSize:b.fontSize/12.8+'cqw',color:b.color,animationDuration:1280/b.speed+'s',animationDirection:b.direction==='right'?'reverse':'normal'});}
}
