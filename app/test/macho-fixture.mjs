// Header-only test data, with no executable instructions.
export function machoFixture(arch,minimum=0x0d0500,library='/usr/lib/libSystem.B.dylib'){
 const name=Buffer.from(library+'\0'),size=Math.ceil((24+name.length)/8)*8,bytes=Buffer.alloc(32+24+size);
 bytes.writeUInt32LE(0xfeedfacf);bytes.writeUInt32LE(arch==='arm64'?0x100000c:0x1000007,4);
 bytes.writeUInt32LE(2,16);bytes.writeUInt32LE(24+size,20);
 bytes.writeUInt32LE(0x32,32);bytes.writeUInt32LE(24,36);bytes.writeUInt32LE(1,40);bytes.writeUInt32LE(minimum,44);
 bytes.writeUInt32LE(0xc,56);bytes.writeUInt32LE(size,60);bytes.writeUInt32LE(24,64);name.copy(bytes,80);return bytes;
}
export function universalFixture(){
 const a=machoFixture('x64'),b=machoFixture('arm64'),header=Buffer.alloc(48);
 header.writeUInt32BE(0xcafebabe);header.writeUInt32BE(2,4);
 for(const [pos,cpu,start,size] of [[8,0x1000007,48,a.length],[28,0x100000c,48+a.length,b.length]]){
  header.writeUInt32BE(cpu,pos);header.writeUInt32BE(start,pos+8);header.writeUInt32BE(size,pos+12);
 }
 return Buffer.concat([header,a,b]);
}
