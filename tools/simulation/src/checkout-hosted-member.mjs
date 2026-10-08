/** Explicit Linux member entrypoint. Import is inert. No key, provider
 * SDK, files, environment inheritance, admin/token auth or financial API shortcut. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {z} from 'zod';
import {validateInput,validateChildEnvironment,digest} from './hosted-checkout-policy.ts';
import {runHostedCheckoutMember} from './hosted-checkout-worker.ts';
import {createCheckoutBrokerClient} from './checkout-broker-ipc.ts';
const startSchema=z.object({protocol:z.literal(1),kind:z.literal('checkout-member-start'),
 expectedHead:z.string().regex(/^[a-f0-9]{40}$/),binding:z.object({manifestDigest:z.string().regex(/^[a-f0-9]{64}$/),
  connectionNonce:z.string().regex(/^[a-f0-9]{32}$/)}).strict(),input:z.unknown()}).strict();
const fail=()=>{throw Error('Checkout member entrypoint rejected; private details withheld.');};
export function validateMemberStart(raw,environment,platform,nodeMajor,now){
 if(platform!=='linux'||nodeMajor!==24)fail();validateChildEnvironment(environment);
 const start=startSchema.parse(raw),input=validateInput(start.input,start.expectedHead,now);
 if(start.binding.manifestDigest!==digest(input.manifest))fail();return{...start,input};
}
function initialMessage(peer,signal){
 return new Promise((accept,reject)=>{
  const cleanup=()=>{peer.removeListener('message',message);peer.removeListener('disconnect',disconnected);peer.removeListener('error',disconnected);signal.removeEventListener('abort',disconnected);clearTimeout(timer);};
  const disconnected=()=>{cleanup();reject(Error('Member start interrupted.'));};
  const message=raw=>{cleanup();try{if(Buffer.byteLength(JSON.stringify(raw))>1048576)fail();accept(raw);}catch{reject(Error('Member start rejected.'));}};
  const timer=setTimeout(disconnected,10000);peer.on('message',message);peer.on('disconnect',disconnected);peer.on('error',disconnected);
  signal.addEventListener('abort',disconnected,{once:true});if(signal.aborted)disconnected();
 });
}
function send(peer,message){
 return new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Member receipt timeout.')),5000);
  try{peer.send(message,error=>{clearTimeout(timer);if(error)reject(Error('Member receipt unavailable.'));else accept();});}
  catch{clearTimeout(timer);reject(Error('Member receipt unavailable.'));}
 });
}
export async function executeCheckoutMember(){
 let broker;const controller=new AbortController(),cancel=()=>controller.abort();
 try{
  if(process.argv.length!==3||process.argv[2]!=='--execute-hosted-member'||!process.send||!process.connected)fail();
  // Explicit four-variable launcher allowlist; reject all incidental credentials.
  if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])!==24)fail();
  validateChildEnvironment(process.env);
  process.on('SIGTERM',cancel);process.on('SIGINT',cancel);process.on('disconnect',cancel);
  const raw=await initialMessage(process,controller.signal);
  const start=validateMemberStart(raw,process.env,process.platform,24,Date.now());
  broker=createCheckoutBrokerClient(process,start.binding);
  const receipt=await runHostedCheckoutMember(start.input,start.expectedHead,{broker,signal:controller.signal});
  broker.close();
  await send(process,{protocol:1,kind:'checkout-member-receipt',...start.binding,receipt});
  process.exitCode=receipt.failed?1:0;
 }catch{process.exitCode=1;}
 finally{
  controller.abort();broker?.close();process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);process.removeListener('disconnect',cancel);
  if(process.connected)process.disconnect();
 }
}
if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url))await executeCheckoutMember();
