import path from 'node:path';

// Windows includes these utilities. Resolve them without relying on the user's PATH.
export function windowsTool(name,{systemRoot=process.env.SystemRoot||process.env.WINDIR||'C:\\Windows'}={}){
  const tools={powershell:['WindowsPowerShell','v1.0','powershell.exe'],taskkill:['taskkill.exe'],browser:['rundll32.exe']};
  if(!Object.hasOwn(tools,name)||!path.win32.isAbsolute(systemRoot))throw Error('Invalid Windows system tool');
  return path.win32.join(systemRoot,'System32',...tools[name]);
}
