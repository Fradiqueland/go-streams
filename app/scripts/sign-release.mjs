// Sign a release manifest using a publisher-owned Ed25519 key kept outside the source tree.
// Usage: node scripts/sign-release.mjs PACKAGE.zip VERSION HTTPS_PACKAGE_URL PRIVATE_KEY.pem MANIFEST.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import {httpsUrl,newer} from '../src/updates.mjs';
const [archive,version,url,keyFile,output,platform='win32']=process.argv.slice(2);
if(!output)throw Error('Usage: PACKAGE.zip VERSION HTTPS_PACKAGE_URL PRIVATE_KEY.pem MANIFEST.json');
if(!['win32','darwin'].includes(platform))throw Error('Platform must be win32 or darwin.');
newer(version,'0.0.0');const key=crypto.createPrivateKey(fs.readFileSync(keyFile));if(key.asymmetricKeyType!=='ed25519')throw Error('Use an Ed25519 private key.');
const stat=fs.statSync(archive);if(stat.size>500*1024*1024)throw Error('Package exceeds 500 MB.');
const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(archive))hash.update(chunk);
const payload=Buffer.from(JSON.stringify({product:'go-streams',platform,version,url:httpsUrl(url),sha256:hash.digest('hex'),bytes:stat.size}));
fs.writeFileSync(output,JSON.stringify({payload:payload.toString('base64'),signature:crypto.sign(null,payload,key).toString('base64')},null,2),{flag:'wx'});
console.log('Signed release manifest created. The private key was not copied.');
