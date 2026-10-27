import fs from 'node:fs';

// Read deployment targets and linked libraries without executing a foreign binary.
export function inspectMachO(bytes){
  function thin(offset,length){
    if(length<32||offset+length>bytes.length||bytes.readUInt32LE(offset)!==0xfeedfacf)throw Error('Invalid 64-bit Mach-O binary');
    const cpu=bytes.readUInt32LE(offset+4),arch=cpu===0x1000007?'x64':cpu===0x100000c?'arm64':null;
    if(!arch)throw Error('Unsupported Mac architecture');
    const count=bytes.readUInt32LE(offset+16),commandBytes=bytes.readUInt32LE(offset+20),limit=offset+32+commandBytes;
    if(limit>offset+length||count>10000)throw Error('Invalid Mach-O load commands');
    let cursor=offset+32,minimum=0;const libraries=[];
    for(let i=0;i<count;i++){
      if(cursor+8>limit)throw Error('Truncated Mach-O load command');
      const command=bytes.readUInt32LE(cursor),size=bytes.readUInt32LE(cursor+4);
      if(size<8||cursor+size>limit)throw Error('Invalid Mach-O load command size');
      if([0xc,0x80000018,0x8000001f,0x20,0x80000023].includes(command)){
        if(size<24)throw Error('Invalid Mach-O library');
        const name=bytes.readUInt32LE(cursor+8),end=bytes.indexOf(0,cursor+name);
        if(name<24||name>=size||end<0||end>=cursor+size)throw Error('Invalid Mach-O library name');
        libraries.push(bytes.toString('utf8',cursor+name,end));
      }
      if(command===0x24){if(size<16)throw Error('Invalid macOS deployment target');minimum=Math.max(minimum,bytes.readUInt32LE(cursor+8));}
      if(command===0x32){if(size<24||bytes.readUInt32LE(cursor+8)!==1)throw Error('Invalid macOS build target');minimum=Math.max(minimum,bytes.readUInt32LE(cursor+12));}
      cursor+=size;
    }
    if(cursor!==limit||!minimum)throw Error('Missing or invalid macOS deployment target');
    return {arch,minimum,libraries};
  }
  if(bytes.length<8)throw Error('Invalid Mach-O binary');
  if(bytes.readUInt32BE(0)!==0xcafebabe)return [thin(0,bytes.length)];
  const count=bytes.readUInt32BE(4);if(count<1||count>8||8+count*20>bytes.length)throw Error('Invalid universal Mac binary');
  const slices=[];
  for(let i=0;i<count;i++){
    const pos=8+i*20,offset=bytes.readUInt32BE(pos+8),length=bytes.readUInt32BE(pos+12);
    if(offset<8+count*20)throw Error('Invalid universal Mac offset');
    slices.push(thin(offset,length));
  }
  if(new Set(slices.map(s=>s.arch)).size!==count)throw Error('Duplicate Mac architecture');
  return slices;
}
export function macRequirements(entries){
  let minimum=0;
  for(const {file,arches} of entries){
    const slices=inspectMachO(fs.readFileSync(file));
    for(const arch of arches)if(!slices.some(s=>s.arch===arch))throw Error('Missing '+arch+' architecture: '+file);
    for(const slice of slices){
      for(const library of slice.libraries)if(!library.startsWith('/usr/lib/')&&!library.startsWith('/System/Library/'))throw Error('External Mac library: '+library+' in '+file);
      minimum=Math.max(minimum,slice.minimum);
    }
  }
  return [minimum>>>16,(minimum>>>8)&255,minimum&255].join('.');
}
