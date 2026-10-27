import {catalogs} from './i18n-data.js';
export const languages=[['en','English','en-GB'],['es','Español','es-ES'],['fr','Français','fr-FR'],['hi','हिन्दी','hi-IN'],['ar','العربية','ar'],['zh','中文','zh-CN'],['bn','বাংলা','bn-BD'],['ru','Русский','ru-RU'],['id','Bahasa Indonesia','id-ID'],['pt-PT','Português','pt-PT']];
export function savedLanguage(storage){try{if(storage===undefined)storage=globalThis.localStorage;const value=storage?.getItem('go-streams-language');return languages.some(([code])=>code===value)?value:'en';}catch{return 'en';}}
let current=savedLanguage();
export function language(){return current;}
export function localeTag(){return languages.find(([code])=>code===current)?.[2]||'en-GB';}
export function setLanguage(code,{persist=true,storage}={}){
 if(!languages.some(([value])=>value===code))throw Error('Unsupported language');
 if(persist)try{if(storage===undefined)storage=globalThis.localStorage;storage?.setItem('go-streams-language',code);}catch{throw Error(tr('Não foi possível guardar o idioma.'));}
 current=code;return code;
}
export function tr(source){
 if(typeof source!=='string'||current==='pt-PT')return source;
 const key=source.trim(),leading=source.slice(0,source.length-source.trimStart().length),trailing=source.slice(source.trimEnd().length);
 const value=catalogs[current]?.[key]??catalogs.en[key];
 return value===undefined?source:leading+value+trailing;
}
export function applyLocale(doc=globalThis.document){
 if(!doc)return;
 doc.title=tr('Go Streams — Estúdio local');const root=doc.documentElement;if(root){root.lang=localeTag();root.dir=current==='ar'?'rtl':'ltr';}
 for(const el of doc.querySelectorAll('[data-i18n]'))el.textContent=tr(el.dataset.i18n);
 for(const el of doc.querySelectorAll('[data-i18n-label]'))el.setAttribute('aria-label',tr(el.dataset.i18nLabel));
 const select=doc.getElementById('language-select');if(select){select.innerHTML=languages.map(([code,label])=>`<option value="${code}">${label}</option>`).join('');select.value=current;select.setAttribute('aria-label',tr('Idioma'));}
}
