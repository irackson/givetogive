/** Original pre-parent failure evidence only. No financial manifest, member,
 * provider, environment loading or replay. Parent invocation is allowed only for
 * its explicit preflight rejection, before any parent namespace or child launch. */
import { createHash } from 'node:crypto';
import { constants,lstatSync,realpathSync,readdirSync,openSync,readFileSync,writeFileSync,fsyncSync,closeSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { z } from 'zod';
import { approved,assetName,digest,limits } from './hosted-checkout-policy.ts';
import { inputMailboxBinding } from './checkout-input-mailbox.ts';
import { seal,unseal,privateFile,type PrivateFile } from './hosted-community-bundle.ts';
import { validateRetainedCheckoutAsset,type CheckoutBootstrapFailureDraft } from './hosted-checkout-github.ts';
const fail=():never=>{throw Error('Bootstrap failure retention unconfirmed; originals preserved locally; no automatic retry.');};
function guard(value:unknown):asserts value{if(!value)fail();}
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function contained(path:string){for(let cursor=resolve(path);;cursor=dirname(cursor)){guard(!lstatSync(cursor).isSymbolicLink()&&realpathSync(cursor)===cursor);if(dirname(cursor)===cursor)break;}}
export function readBootstrapOriginal(path:string,maximum=2*1024*1024){
 contained(path);const stat=lstatSync(path);guard(stat.isFile()&&stat.nlink===1&&stat.size<=maximum);
 if(process.platform==='linux')guard((stat.mode&0o077)===0);
 const fd=openSync(path,constants.O_RDONLY|(process.platform==='linux'?constants.O_NOFOLLOW:0));
 try{const bytes=readFileSync(fd);guard(bytes.length===stat.size);return bytes;}finally{closeSync(fd);}
}
export function writeBootstrapOriginal(directory:string,name:string,bytes:Buffer,maximum=2*1024*1024){
 contained(directory);guard(bytes.length<=maximum);const fd=openSync(join(directory,name),'wx',0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
 if(process.platform==='linux'){const dir=openSync(directory,'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
 const retained=readBootstrapOriginal(join(directory,name),maximum);try{guard(retained.equals(bytes));}finally{retained.fill(0);}
}
export async function retainCheckoutBootstrapFailure(rawBinding:unknown,directory:string,key:Buffer,
 phase:'readiness'|'input-transfer'|'input-validation'|'member-environment',
 draft:Pick<CheckoutBootstrapFailureDraft,'upload'>,signal:AbortSignal,
 parentPreflight?:{parentInvoked:true;memberLaunchAdmitted:false;phase:'input'|'environment'|'key'|'source'|'memory'|'abort'}){
 let encrypted:Buffer|undefined,ownedKey:Buffer|undefined;
 try{
  const binding=inputMailboxBinding.parse(rawBinding);directory=resolve(directory);contained(directory);
  guard(Buffer.isBuffer(key)&&key.length===32);signal.throwIfAborted();ownedKey=Buffer.from(key);
  z.enum(['readiness','input-transfer','input-validation','member-environment']).parse(phase);
  const preflight=parentPreflight===undefined?undefined:z.object({parentInvoked:z.literal(true),memberLaunchAdmitted:z.literal(false),
   phase:z.enum(['input','environment','key','source','memory','abort'])}).strict().parse(parentPreflight);
  const name=assetName({releaseId:binding.releaseId,operationId:approved.operationId,job:{id:binding.jobId,nonce:binding.jobNonce,headSha:binding.headSha}},'final');
  const originals=new Set(['bootstrap-lease.json','readiness-publication.intent.json','readiness-publication.result.json',
   'input-selection.intent.json','original-input.g2genc','bootstrap-failure.json']);
  const own=new Set(['bootstrap-final-upload.intent.json','bootstrap-final-upload.result.json',name]);
  const snapshot=()=>{
   const files:PrivateFile[]=[];let total=0;
   for(const filename of readdirSync(directory).sort()){
    if(own.has(filename))continue;
    if(['member-home','member-tmp'].includes(filename)){
     const path=join(directory,filename);contained(path);guard(lstatSync(path).isDirectory()&&readdirSync(path).length===0);continue;
    }
    guard(originals.has(filename));const bytes=readBootstrapOriginal(join(directory,filename));
    try{total+=bytes.length;guard(total<=4*1024*1024);files.push(privateFile(filename,bytes));}finally{bytes.fill(0);}
   }
   return files;
  };
  // Unknown files or a parent directory fail BEFORE any failure upload admission.
  const initial=snapshot(),lease=initial.find(file=>file.name==='bootstrap-lease.json');guard(lease);
  const leaseValue=JSON.parse(Buffer.from(lease.bytes,'base64').toString('utf8'));
  guard(leaseValue.headSha===binding.headSha&&leaseValue.jobNonce===binding.jobNonce&&leaseValue.maximumMemberLaunches===1&&
   leaseValue.retryAllowed===false&&leaseValue.paymentAccepted===false);
  const failure=Buffer.from(JSON.stringify({protocol:1,purpose:'pre-parent-bootstrap-failure',binding,phase,
   parentInvoked:preflight?.parentInvoked??false,parentPreflight:preflight??null,memberLaunchAdmitted:false,
   failed:true,paymentAccepted:false,retryAllowed:false,privateDetailsWithheld:true}));
  try{writeBootstrapOriginal(directory,'bootstrap-failure.json',failure);}finally{failure.fill(0);}
  const before=snapshot(),filesDigest=digest(before.map(({name,digest})=>({name,digest})));
  const intent=Buffer.from(JSON.stringify({protocol:1,binding,phase:'final',originalFilesDigest:filesDigest,maximumUploads:1,paymentAccepted:false,retryAllowed:false}));
  try{writeBootstrapOriginal(directory,'bootstrap-final-upload.intent.json',intent);}finally{intent.fill(0);}
  encrypted=seal({protocol:1,kind:'original-checkout-bootstrap-failure',binding,files:before,parentInvoked:preflight?.parentInvoked??false,
   parentPreflight:preflight??null,memberLaunchAdmitted:false,
   failed:true,paymentAccepted:false,retryAllowed:false},ownedKey);
  guard(encrypted.length<=limits.checkpointBytes);
  const decoded=unseal(encrypted,ownedKey) as {binding:unknown;files:PrivateFile[]};
  guard(digest(decoded.binding)===digest(binding)&&digest(decoded.files)===digest(before));
  writeBootstrapOriginal(directory,name,encrypted,limits.checkpointBytes);
  const unchanged=()=>guard(digest(snapshot().map(({name,digest})=>({name,digest})))===filesDigest);
  unchanged();signal.throwIfAborted();const ciphertextDigest=hash(encrypted);
  const retained=validateRetainedCheckoutAsset(await draft.upload('final',encrypted,signal));signal.throwIfAborted();unchanged();guard(hash(encrypted)===ciphertextDigest);
  const onDisk=readBootstrapOriginal(join(directory,name),limits.checkpointBytes);try{guard(onDisk.equals(encrypted));}finally{onDisk.fill(0);}
  guard(retained.phase==='final'&&retained.name===name&&retained.operationId===approved.operationId&&retained.releaseId===binding.releaseId&&
   retained.jobId===binding.jobId&&retained.jobNonce===binding.jobNonce&&retained.headSha===binding.headSha&&retained.ciphertextDigest===ciphertextDigest&&
   retained.size===encrypted.length&&Number.isSafeInteger(retained.assetId)&&retained.assetId>0&&retained.anonymousDraft404===true&&retained.anonymousAsset404===true&&
   retained.exactRetainedAssetVerified===true&&retained.readbackVerified===true&&retained.retryAllowed===false&&retained.paymentAccepted===false);
  guard(Date.now()-Date.parse(retained.observedAt)>=-5000&&Date.now()-Date.parse(retained.observedAt)<=30000);
  const result=Buffer.from(JSON.stringify(retained));try{writeBootstrapOriginal(directory,'bootstrap-final-upload.result.json',result);}finally{result.fill(0);}
  return retained;
 }catch{return fail();}finally{encrypted?.fill(0);ownedKey?.fill(0);}
}
