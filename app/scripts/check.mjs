import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const folder of ['src','public','electron','scripts','test','test/optional']) {
  const directory=path.join(root,folder);
  for(const file of fs.readdirSync(directory).filter(f=>/\.(mjs|cjs|js)$/.test(f))) {
    const result=spawnSync(process.execPath,['--check',path.join(directory,file)],{stdio:'inherit',windowsHide:true});
    if(result.status!==0)process.exit(result.status||1);
  }
}
console.log('Sintaxe verificada em todos os módulos JavaScript.');
