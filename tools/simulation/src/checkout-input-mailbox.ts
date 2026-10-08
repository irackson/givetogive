/** Initial encrypted input before a financial manifest exists. No provider or
 * member authentication. Only the exact private unpublished draft and selected
 * job-nonce input may be read; a selected download is durably consumed first. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { approved,limits } from './hosted-checkout-policy.ts';
const fail=():never=>{throw Error('Checkout input transfer unconfirmed; no automatic retry or financial admission.');};
function guard(value:unknown):asserts value {if(!value)fail();}
export const inputMailboxBinding=z.object({headSha:z.string().regex(/^[a-f0-9]{40}$/),
 releaseId:z.number().int().positive(),jobId:z.string().regex(/^[1-9][0-9]{0,19}$/),
 jobNonce:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
type Binding=z.infer<typeof inputMailboxBinding>;
export async function checkoutResponseBytes(response:Response,maximum:number,parent:AbortSignal,expected?:number) {
 const signal=AbortSignal.any([parent,AbortSignal.timeout(15000)]);signal.throwIfAborted();
 guard(response.body);const reader=response.body.getReader(),parts:Buffer[]=[];let size=0;
 try {
  for(;;){signal.throwIfAborted();let remove=()=>{};
   const aborted=new Promise<never>((__resolve,reject)=>{const stop=()=>reject(Error('cancelled'));
    signal.addEventListener('abort',stop,{once:true});remove=()=>signal.removeEventListener('abort',stop);});
   let chunk:ReadableStreamReadResult<Uint8Array>;
   try{chunk=await Promise.race([reader.read(),aborted]);}finally{remove();}
   signal.throwIfAborted();if(chunk.done)break;size+=chunk.value.length;guard(size<=maximum&&(expected===undefined||size<=expected));parts.push(Buffer.from(chunk.value));
  }
  guard(expected===undefined||size===expected);return Buffer.concat(parts);
 }finally{for(const part of parts)part.fill(0);void reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export function initialCheckoutAssetName(binding:Binding) {
 return `checkout-${approved.operationId}-${binding.jobId}-1-${binding.jobNonce}-input.g2genc`;
}
export async function downloadBootstrapInput(raw:unknown,options:{token:string;signal:AbortSignal;
 persistSelection:(value:{assetId:number;name:string;size:number;digest:string})=>void;
 request?:typeof fetch;pause?:(signal:AbortSignal)=>Promise<unknown>}) {
 let selected=false,bytes:Buffer|undefined;
 try {
  const binding=inputMailboxBinding.parse(raw),name=initialCheckoutAssetName(binding),request=options.request??fetch;
  guard(options.token.length>=20&&options.token.length<=4096&&!/[\r\n]/.test(options.token));
  const api=`https://api.github.com/repos/${approved.repository}`,headers={Authorization:`Bearer ${options.token}`,
   Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};
  const signal=AbortSignal.any([options.signal,AbortSignal.timeout(600000)]);
  const active=()=>signal.throwIfAborted();
  async function requestApi(path:string,anonymous=false,accept='application/vnd.github+json') {
   active();return request(`${api}/${path}`,{headers:anonymous?{Accept:accept}:{...headers,Accept:accept},
    redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  }
  async function collect(response:Response,maximum:number,expected?:number) {
   return checkoutResponseBytes(response,maximum,signal,expected);
  }
  async function private404(path:string) {
   const response=await requestApi(path,true);try{active();guard(response.status===404);}finally{void response.body?.cancel().catch(()=>undefined);}
  }
  const assetSchema=z.object({id:z.number().int().positive(),name:z.literal(name),size:z.number().int().min(37).max(limits.inputBytes+65536),
   digest:z.string().regex(/^sha256:[a-f0-9]{64}$/),state:z.literal('uploaded')});
  async function inventory() {
   await private404(`releases/${binding.releaseId}`);
   const response=await requestApi(`releases/${binding.releaseId}`);
   if(response.status!==200){void response.body?.cancel().catch(()=>undefined);fail();}const raw=await collect(response,262144);
   try {
    const value=z.object({id:z.literal(binding.releaseId),draft:z.literal(true),prerelease:z.literal(false),published_at:z.null(),
     target_commitish:z.literal(binding.headSha),tag_name:z.literal(`checkout-acceptance-${approved.operationId}`),
     body:z.string().max(4096),assets:z.array(assetSchema).max(1)}).parse(JSON.parse(raw.toString('utf8')));
    z.object({protocol:z.literal(1),purpose:z.literal('one-member-test-checkout-policy'),repository:z.literal(approved.repository),
     runId:z.literal(approved.runId),operationId:z.literal(approved.operationId),headSha:z.literal(binding.headSha)}).strict().parse(JSON.parse(value.body));
    await private404(`releases/${binding.releaseId}`);return value.assets[0];
   }finally{raw.fill(0);}
  }
  let asset=await inventory();
  while(!asset){active();await (options.pause??(async signal=>{const {setTimeout}=await import('node:timers/promises');await setTimeout(2000,undefined,{signal});}))(signal);asset=await inventory();}
  guard(!selected);selected=true;
  options.persistSelection({assetId:asset.id,name:asset.name,size:asset.size,digest:asset.digest});
  await private404(`releases/assets/${asset.id}`);
  const before=await inventory();guard(before&&JSON.stringify(before)===JSON.stringify(asset));
  let response=await requestApi(`releases/assets/${asset.id}`,false,'application/octet-stream');
  if([302,307].includes(response.status)) {
   const url=new URL(response.headers.get('location')??'');void response.body?.cancel().catch(()=>undefined);
   guard(url.protocol==='https:'&&url.hostname==='release-assets.githubusercontent.com'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443'));
   response=await request(url,{redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
  }
  if(response.status!==200){void response.body?.cancel().catch(()=>undefined);fail();}bytes=await collect(response,limits.inputBytes+65536,asset.size);
  guard(bytes.subarray(0,8).toString()==='G2GHOST1'&&`sha256:${createHash('sha256').update(bytes).digest('hex')}`===asset.digest);
  const after=await inventory();guard(after&&JSON.stringify(after)===JSON.stringify(asset));
  await private404(`releases/assets/${asset.id}`);active();
  return {ciphertext:bytes,assetId:asset.id,ciphertextDigest:asset.digest.slice(7),
   transportEvidence:options.request?'injected-offline-http':'private-draft-input-readback',paymentAccepted:false as const,retryAllowed:false as const};
 }catch{bytes?.fill(0);return fail();}
}
