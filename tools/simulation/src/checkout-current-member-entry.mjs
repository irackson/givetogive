/** Explicit owned-IPC Linux entrypoint. Import/default invocation are inert.
 * Initial message contains public profile only; private input follows real browser
 * readiness. No provider/SQL/admin/GitHub/encryption key in this process. */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {z} from 'zod';
import {checkoutParentSourceSnapshot} from './hosted-checkout-parent.ts';
import {validateChildEnvironment} from './hosted-checkout-policy.ts';
import {prepareCurrentCheckoutMember,runCurrentCheckoutMember,closePreparedCurrentCheckoutMember} from './checkout-current-member.ts';
import {validateCurrentCheckoutInput} from './checkout-current-input.ts';
import {createCurrentMemberClient} from './checkout-current-ipc.ts';
const prepareSchema=z.object({protocol:z.literal(1),kind:z.literal('current-member-prepare'),headSha:z.string().regex(/^[a-f0-9]{40}$/),
 source:z.object({canonicalSourceDigest:z.string(),rootLockDigest:z.string(),runnerDigest:z.string()}).strict(),profile:z.unknown()}).strict();
const inputSchema=z.object({protocol:z.literal(1),kind:z.literal('current-member-input'),connectionNonce:z.string().regex(/^[a-f0-9]{32}$/),input:z.unknown()}).strict();
const fail=()=>{throw Error('Current member entry stopped; no retry; private details withheld.');};
function sources(start){const actual=checkoutParentSourceSnapshot(start.headSha);
 if(Object.keys(actual).some(key=>actual[key]!==start.source[key]))fail();}
function receive(peer,signal,timeoutMs){return new Promise((accept,reject)=>{
 const cleanup=()=>{clearTimeout(timer);peer.removeListener('message',message);peer.removeListener('disconnect',stop);peer.removeListener('error',stop);signal.removeEventListener('abort',stop);};
 const stop=()=>{cleanup();reject(Error('Current member receive stopped.'));};
 const message=raw=>{cleanup();try{if(Buffer.byteLength(JSON.stringify(raw))>65536)fail();accept(raw);}catch{reject(Error('Current member input rejected.'));}};
 const timer=setTimeout(stop,timeoutMs);peer.on('message',message);peer.on('disconnect',stop);peer.on('error',stop);
 signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
});}
function send(peer,value){return new Promise((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Current member send stopped.')),5000);
 try{peer.send(value,error=>{clearTimeout(timer);if(error)reject(Error('Current member send failed.'));else accept();});}catch{clearTimeout(timer);reject(Error('Current member send failed.'));}});}
export async function executeCurrentMember(){let prepared,client;const controller=new AbortController(),stop=()=>controller.abort();
 try{
  if(process.argv.length!==3||process.argv[2]!=='--execute-current-member'||!process.connected||!process.send||
   process.platform!=='linux'||Number(process.versions.node.split('.')[0])!==24)fail();
  validateChildEnvironment(process.env);process.on('SIGTERM',stop);process.on('SIGINT',stop);process.on('disconnect',stop);
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(900000)]);
  const start=prepareSchema.parse(await receive(process,signal,10000));sources(start);
  prepared=await prepareCurrentCheckoutMember(start.profile,start.headSha,start.source,{signal});sources(start);
  // Install input listener before readiness, so immediate parent input cannot race it.
  const waitingInput=receive(process,signal,600000);void waitingInput.catch(()=>undefined);
  await send(process,{protocol:1,kind:'current-member-ready',ready:prepared.ready});
  const transfer=inputSchema.parse(await waitingInput);if(transfer.connectionNonce!==prepared.ready.connectionNonce)fail();
  const input=validateCurrentCheckoutInput(transfer.input,prepared.profile,Date.now());sources(start);
  client=createCurrentMemberClient(process,{profileDigest:input.profileDigest,connectionNonce:prepared.ready.connectionNonce});
  const broker={phase:async(phase,identity,phaseSignal)=>{sources(start);const result=await client.phase(phase,identity,phaseSignal);sources(start);return result;}};
  const receipt=await runCurrentCheckoutMember(prepared,input,broker,signal);client.close();
  await send(process,{protocol:1,kind:'current-member-receipt',connectionNonce:prepared.ready.connectionNonce,profileDigest:input.profileDigest,receipt});
  process.exitCode=receipt.failed?1:0;
 }catch{process.exitCode=1;}
 finally{controller.abort();client?.close();if(prepared)await closePreparedCurrentCheckoutMember(prepared).catch(()=>undefined);
  process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);process.removeListener('disconnect',stop);
  if(process.connected)process.disconnect();}
}
if(resolve(process.argv[1]??'')===fileURLToPath(import.meta.url)&&process.argv.length>2)await executeCurrentMember();
