// Explicit Windows-only provisioning of a non-Stripe transfer key. No env/key
// dump, provider authority, automatic replacement or retry. Default is inert.
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,lstatSync,realpathSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository='irackson/givetogive',name='CHECKOUT_STAGING_BUNDLE_KEY';
const directory=fileURLToPath(new URL('../.state/checkout-key/',import.meta.url));
const guard=value=>{if(!value)throw Error('Checkout transfer key provisioning unconfirmed; no automatic retry; private details withheld.');};
function jsonGh(args){return JSON.parse(execFileSync('gh.exe',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000,maxBuffer:262144}));}
function original(filename,value){
 const bytes=Buffer.from(JSON.stringify(value)),fd=openSync(join(directory,filename),'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 guard(readFileSync(join(directory,filename)).equals(bytes));bytes.fill(0);
}
export function protectCheckoutTransferKey(bytes){
 guard(process.platform==='win32'&&Buffer.isBuffer(bytes)&&bytes.length===32);
 // Key travels on stdin, never argv/logs. Ciphertext stdout is consumed privately.
 const code="Add-Type -AssemblyName System.Security; $taskInput=[Console]::In.ReadToEnd(); $taskBytes=[Convert]::FromBase64String($taskInput); $taskEntropy=[Text.Encoding]::UTF8.GetBytes('givetogive-checkout-broker-key-v1'); $taskProtected=[Security.Cryptography.ProtectedData]::Protect($taskBytes,$taskEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Array]::Clear($taskBytes,0,$taskBytes.Length); [Console]::Out.Write([Convert]::ToBase64String($taskProtected))";
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:16384});
 guard(result.status===0&&!result.stderr&&/^[A-Za-z0-9+/=]+$/.test(result.stdout));return result.stdout;
}
export function loadCheckoutTransferKey(){
 guard(process.platform==='win32');
 const stored=JSON.parse(readFileSync(join(directory,'key.dpapi.json'),'utf8'));
 guard(stored.protocol===1&&stored.purpose==='checkout-transfer-only'&&stored.protection==='windows-current-user-dpapi');
 const code="Add-Type -AssemblyName System.Security; $taskInput=[Console]::In.ReadToEnd(); $taskBytes=[Convert]::FromBase64String($taskInput); $taskEntropy=[Text.Encoding]::UTF8.GetBytes('givetogive-checkout-broker-key-v1'); $taskClear=[Security.Cryptography.ProtectedData]::Unprotect($taskBytes,$taskEntropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($taskClear)); [Array]::Clear($taskClear,0,$taskClear.Length)";
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{input:stored.ciphertext,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:16384});
 guard(result.status===0&&!result.stderr);const key=Buffer.from(result.stdout,'base64');
 guard(key.length===32&&createHash('sha256').update(key).digest('hex')===stored.keyDigest);return key;
}
export function provisionCheckoutTransferKey(){
 guard(process.platform==='win32'&&jsonGh(['api','user']).login==='irackson');
 guard(!jsonGh(['secret','list','--repo',repository,'--json','name']).some(secret=>secret.name===name));
 const parent=dirname(directory.replace(/[\\/]$/,''));
 guard(existsSync(parent)&&!lstatSync(parent).isSymbolicLink()&&realpathSync(parent).toLowerCase()===parent.toLowerCase());
 guard(!existsSync(directory));mkdirSync(directory,{mode:0o700});
 let key;
 try{
  key=randomBytes(32);const keyDigest=createHash('sha256').update(key).digest('hex'),createdAt=new Date().toISOString();
  original('key.dpapi.json',{protocol:1,purpose:'checkout-transfer-only',protection:'windows-current-user-dpapi',ciphertext:protectCheckoutTransferKey(key),keyDigest,createdAt});
  const restored=loadCheckoutTransferKey();try{guard(restored.equals(key));}finally{restored.fill(0);}
  original('provision.intent.json',{protocol:1,repository,name,keyDigest,maximumWrites:1,createdAt,retryAllowed:false,paymentAuthority:false});
  const result=spawnSync('gh.exe',['secret','set',name,'--repo',repository,'--app','actions'],{input:key.toString('hex'),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16384});
  guard(result.status===0);
  const names=jsonGh(['secret','list','--repo',repository,'--json','name']);guard(names.some(secret=>secret.name===name));
  original('provision.result.json',{protocol:1,repository,name,writeAccepted:true,secretNameReadback:true,secretValueReadbackAvailable:false,
   localDpapiRoundTripVerified:true,providerCredentialsTransferred:false,paymentAuthority:false,retryAllowed:false,observedAt:new Date().toISOString()});
  return {provisioned:true,repository,secretName:name,localDpapiRoundTripVerified:true,secretValueReadbackAvailable:false,providerCredentialsTransferred:false,paymentAuthority:false};
 }finally{key?.fill(0);}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{if(process.argv.length===3&&process.argv[2]==='--provision')console.log(JSON.stringify(provisionCheckoutTransferKey()));
 else{guard(process.argv.length===2);console.log(JSON.stringify({execute:false,externalWrites:0,paymentAuthority:false}));}}
 catch{console.error('Checkout transfer key provisioning unconfirmed; local intent retained when admitted; no automatic retry.');process.exitCode=1;}
}
