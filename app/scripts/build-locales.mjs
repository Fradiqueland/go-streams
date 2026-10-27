import fs from 'node:fs';
import path from 'node:path';
export function buildCatalogs(root){
 const folder=path.join(root,'public','locales');
 const catalogs=Object.fromEntries(fs.readdirSync(folder).filter(name=>name.endsWith('.json')).sort().map(name=>[name.slice(0,-5),JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'))]));
 fs.writeFileSync(path.join(root,'public','i18n-data.js'),'export const catalogs='+JSON.stringify(catalogs)+';\n');
}
