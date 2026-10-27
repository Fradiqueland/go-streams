function partsAt(time,zone) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(time);
  return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
}
export function localToUtc(value,zone,disambiguation='reject') {
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value||'');
  if(!m)throw Error('Introduza uma data e hora válidas.');
  const [year,month,day,hour,minute]=m.slice(1).map(Number);
  const target=Date.UTC(year,month-1,day,hour,minute);
  const check=new Date(target);
  if(year<2000||check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day||hour>23||minute>59)throw Error('Introduza uma data e hora válidas.');
  const offsets=new Set();
  try {
    for(let delta=-36;delta<=36;delta+=3){const time=target+delta*3600000;const p=partsAt(time,zone);offsets.add(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-time);}
  }catch{throw Error('Escolha um fuso horário válido.');}
  const matches=[...offsets].map(offset=>target-offset).filter(time=>{const p=partsAt(time,zone);return p.year===year&&p.month===month&&p.day===day&&p.hour===hour&&p.minute===minute;}).sort((a,b)=>a-b);
  if(!matches.length)throw Error('Esta hora não existe neste fuso devido à mudança de hora. Escolha outra hora.');
  if(matches.length>1&&!['earlier','later'].includes(disambiguation))throw Error('Esta hora ocorre duas vezes na mudança de hora. Escolha a primeira ou a segunda ocorrência.');
  return new Date(disambiguation==='later'?matches.at(-1):matches[0]).toISOString();
}
export function utcToLocal(value,zone) {
  const p=partsAt(new Date(value).getTime(),zone);const pad=x=>String(x).padStart(2,'0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
