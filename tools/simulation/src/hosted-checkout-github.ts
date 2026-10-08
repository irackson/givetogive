/** Explicit Checkout-only transport. Import/constructor perform no IO, env reads or actions.
 * The reviewed broker must persist one-shot permissions across process loss BEFORE invoking methods.
 * This transport cannot establish provider ownership, durability or payment acceptance. */
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { approved, assetName, limits, validateAssetSet, validateManifest, type Manifest } from './hosted-checkout-policy.ts';

export type CheckoutAssetPhase = Parameters<typeof assetName>[1];
const phases: readonly CheckoutAssetPhase[] = ['input','open-proof','submit-proof','ack-intent','submit-intent','final'];
const metadataBytes = 256 * 1024;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fail(): never { throw new Error('Checkout private transport rejected; private details withheld. Never automatically retry.'); }
function guard(value: unknown): asserts value { if (!value) fail(); }
const assetSchema = z.object({id:z.number().int().positive(),name:z.string(),size:z.number().int().min(37).max(limits.checkpointBytes),
 digest:z.string().regex(/^sha256:[a-f0-9]{64}$/),state:z.literal('uploaded')}).passthrough();
type Asset = z.infer<typeof assetSchema>;
const releaseSchema = z.object({id:z.number().int().positive(),draft:z.literal(true),prerelease:z.literal(false),published_at:z.null(),
 target_commitish:z.string(),tag_name:z.string(),body:z.string().max(4096),assets:z.array(assetSchema).max(limits.maxAssets)}).passthrough();
type Release = z.infer<typeof releaseSchema>;
const bodySchema = z.object({protocol:z.literal(1),purpose:z.literal('one-member-test-checkout-policy'),
 repository:z.literal(approved.repository),runId:z.literal(approved.runId),operationId:z.literal(approved.operationId),headSha:z.string()}).strict();
export type RetainedCheckoutAsset = {phase:CheckoutAssetPhase;assetId:number;name:string;size:number;ciphertextDigest:string;
 releaseId:number;jobId:string;jobNonce:string;headSha:string;operationId:string;anonymousDraft404:true;anonymousAsset404:true;
 observedAt:string;exactRetainedAssetVerified:true;readbackVerified:true;retryAllowed:false;paymentAccepted:false};
type Dependencies = { request?:typeof fetch; now?:()=>number;
 pause?:(milliseconds:number,signal:AbortSignal)=>Promise<unknown> };

/** No release/tag mutation APIs. Token stays in this broker-owned object, never in worker output. */
export class CheckoutPrivateDraft {
 readonly manifest: Manifest;
 private token: string;
 private request: typeof fetch;
 private now: ()=>number;
 private pause: (milliseconds:number,signal:AbortSignal)=>Promise<unknown>;
 private downloads = new Set<CheckoutAssetPhase>();
 private uploads = new Set<CheckoutAssetPhase>();
 constructor(rawManifest:unknown,expectedHead:string,token:string,dependencies:Dependencies={}) {
  this.now=dependencies.now??Date.now;
  this.manifest=validateManifest(rawManifest,expectedHead,this.now());
  const freeze=(value:object)=>{for(const child of Object.values(value))if(child&&typeof child==='object')freeze(child);Object.freeze(value);};
  freeze(this.manifest);
  guard(typeof token==='string'&&token.length>=20&&token.length<=4096&&!/[\r\n]/.test(token));this.token=token;
  this.request=dependencies.request??fetch;
  this.pause=dependencies.pause??((milliseconds,signal)=>sleep(milliseconds,undefined,{signal}));
 }
 private headers() {return {Authorization:`Bearer ${this.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};}
 private api(path:string){return `https://api.github.com/repos/${approved.repository}/${path}`;}
 private signal(parent?:AbortSignal,milliseconds=30000){return parent?AbortSignal.any([parent,AbortSignal.timeout(milliseconds)]):AbortSignal.timeout(milliseconds);}
 private active(signal:AbortSignal){signal.throwIfAborted();guard(Number.isFinite(this.now()));}
 private async stream(response:Response,maximum:number,signal:AbortSignal,expected?:number):Promise<Buffer> {
  let output:Buffer|undefined;const chunks:Buffer[]=[];let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try {
   this.active(signal);guard(response.body);reader=response.body.getReader();let length=0;
   for(;;){
    this.active(signal);let remove=()=>{};
    const cancelled=new Promise<never>((__resolve,reject)=>{const stop=()=>reject(new Error('cancelled'));
     signal.addEventListener('abort',stop,{once:true});remove=()=>signal.removeEventListener('abort',stop);});
    let part:ReadableStreamReadResult<Uint8Array>;
    try{part=await Promise.race([reader.read(),cancelled]);}finally{remove();}
    this.active(signal);if(part.done)break;
    length+=part.value.byteLength;guard(length<=maximum&&(expected===undefined||length<=expected));
    chunks.push(Buffer.from(part.value));
   }
   guard(expected===undefined||length===expected);output=Buffer.concat(chunks);this.active(signal);return output;
  } catch {output?.fill(0);return fail();}
  finally{for(const chunk of chunks)chunk.fill(0);if(reader){void reader.cancel().catch(()=>undefined);try{reader.releaseLock();}catch{}}else void response.body?.cancel().catch(()=>undefined);}
 }
 private async json(response:Response,signal:AbortSignal) {
  const bytes=await this.stream(response,metadataBytes,signal);
  try{return JSON.parse(bytes.toString('utf8')) as unknown;}finally{bytes.fill(0);}
 }
 private inventory(raw:unknown):Release {
  const value=releaseSchema.parse(raw),m=this.manifest;
  guard(value.id===m.releaseId&&value.target_commitish===m.job.headSha&&value.tag_name===`checkout-acceptance-${m.operationId}`);
  const association=bodySchema.parse(JSON.parse(value.body));guard(association.headSha===m.job.headSha);
  const names=phases.map(phase=>assetName(m,phase));
  guard(value.assets.every(asset=>names.includes(asset.name))&&new Set(value.assets.map(asset=>asset.name)).size===value.assets.length
   &&new Set(value.assets.map(asset=>asset.id)).size===value.assets.length);
  return value;
 }
 private async inspectInternal(signal:AbortSignal):Promise<Release> {
  this.active(signal);const response=await this.request(this.api(`releases/${this.manifest.releaseId}`),
   {headers:this.headers(),redirect:'error',signal:this.signal(signal)});
  if(response.status!==200){void response.body?.cancel().catch(()=>undefined);fail();}
  return this.inventory(await this.json(response,signal));
 }
 private async private404(path:string,signal:AbortSignal) {
  this.active(signal);const response=await this.request(this.api(path),{headers:{Accept:'application/vnd.github+json'},redirect:'manual',signal:this.signal(signal)});
  try{this.active(signal);guard(response.status===404);}finally{void response.body?.cancel().catch(()=>undefined);}
 }
 async inspect(signal?:AbortSignal):Promise<{releaseId:number;assets:{id:number;name:string;size:number;digest:string}[];privateDraftVerified:true}> {
  try{const active=this.signal(signal);await this.private404(`releases/${this.manifest.releaseId}`,active);
   const value=await this.inspectInternal(active);await this.private404(`releases/${this.manifest.releaseId}`,active);
   return {releaseId:value.id,assets:value.assets.map(({id,name,size,digest})=>({id,name,size,digest})),privateDraftVerified:true};
  }catch{fail();}
 }
 private same(a:Asset|undefined,b:Asset){guard(a&&a.id===b.id&&a.name===b.name&&a.size===b.size&&a.digest===b.digest&&a.state===b.state);}
 private async downloadSelected(file:Asset,signal:AbortSignal):Promise<Buffer> {
  let bytes:Buffer|undefined,response:Response|undefined;
  try{
   await this.private404(`releases/${this.manifest.releaseId}`,signal);await this.private404(`releases/assets/${file.id}`,signal);
   this.same((await this.inspectInternal(signal)).assets.find(asset=>asset.name===file.name),file);
   response=await this.request(this.api(`releases/assets/${file.id}`),
    {headers:{...this.headers(),Accept:'application/octet-stream'},redirect:'manual',signal:this.signal(signal)});
   this.active(signal);
   if([302,307].includes(response.status)){
    const location=response.headers.get('location')??'';void response.body?.cancel().catch(()=>undefined);
    const url=new URL(location);guard(url.protocol==='https:'&&url.hostname==='release-assets.githubusercontent.com'&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443'));
    response=await this.request(url,{redirect:'error',signal:this.signal(signal)}); // NEVER forward GitHub authorization to CDN.
   }
   if(response.status!==200){void response.body?.cancel().catch(()=>undefined);fail();}
   bytes=await this.stream(response,limits.checkpointBytes,signal,file.size);
   guard(bytes.subarray(0,8).toString()==='G2GHOST1'&&file.digest===`sha256:${sha256(bytes)}`);
   this.same((await this.inspectInternal(signal)).assets.find(asset=>asset.name===file.name),file);
   await this.private404(`releases/${this.manifest.releaseId}`,signal);await this.private404(`releases/assets/${file.id}`,signal);
   this.active(signal);return bytes;
  }catch{bytes?.fill(0);return fail();}finally{void response?.body?.cancel().catch(()=>undefined);}
 }
 /** Consume before FIRST GET. Missing asset alone can poll; selected asset is never downloaded twice.
  * Returned owned ciphertext must be wiped by its recipient after validation/decryption. */
 async download(phase:CheckoutAssetPhase,parent?:AbortSignal):Promise<Buffer> {
  try{
   guard(phases.includes(phase)&&!this.downloads.has(phase));this.downloads.add(phase);
   const signal=this.signal(parent,600000),deadline=this.now()+600000,name=assetName(this.manifest,phase);
   const active=()=>{this.active(signal);guard(this.now()<deadline);};
   active();await this.private404(`releases/${this.manifest.releaseId}`,signal);
   let file:Asset|undefined;
   while(!file){active();file=(await this.inspectInternal(signal)).assets.find(asset=>asset.name===name);active();
    if(!file){await this.pause(Math.min(5000,Math.max(0,deadline-this.now())),signal);active();}}
   const result=await this.downloadSelected(file,signal);try{active();return result;}catch{result.fill(0);fail();}
  }catch{fail();}
 }
 /** Broker must have fsynced its exclusive upload intent before calling. No request retry or overwrite.
  * Caller owns ciphertext; transport clears only its copy and its owned readback buffers. */
 async upload(phase:CheckoutAssetPhase,ciphertext:Buffer,parent?:AbortSignal):Promise<RetainedCheckoutAsset> {
  let owned:Uint8Array<ArrayBuffer>|undefined,readback:Buffer|undefined;
  try{
   guard(phases.includes(phase)&&!this.uploads.has(phase)&&!this.downloads.has(phase));this.uploads.add(phase);this.downloads.add(phase);
   guard(Buffer.isBuffer(ciphertext)&&ciphertext.length>36&&ciphertext.length<=limits.checkpointBytes&&ciphertext.subarray(0,8).toString()==='G2GHOST1');
   // Snapshot BEFORE the first await so caller mutation cannot alter the admitted ciphertext.
   owned=new Uint8Array(ciphertext);const expectedDigest=sha256(owned),expectedSize=owned.length;
   const signal=this.signal(parent,180000),name=assetName(this.manifest,phase);
   await this.private404(`releases/${this.manifest.releaseId}`,signal);
   const before=await this.inspectInternal(signal);
   validateAssetSet(before.assets.map(({id,name,size,digest})=>({id,name,size,digest:digest.slice(7)})),this.manifest,phase);
   await this.private404(`releases/${this.manifest.releaseId}`,signal);
   this.active(signal);
   const response=await this.request(`https://uploads.github.com/repos/${approved.repository}/releases/${this.manifest.releaseId}/assets?name=${encodeURIComponent(name)}`,
    {method:'POST',headers:{...this.headers(),'Content-Type':'application/octet-stream','Content-Length':String(expectedSize)},
     body:owned,redirect:'error',signal:this.signal(signal,120000)});
   if(response.status!==201){void response.body?.cancel().catch(()=>undefined);fail();}
   const uploaded=assetSchema.parse(await this.json(response,signal));
   guard(uploaded.name===name&&uploaded.size===expectedSize&&uploaded.digest===`sha256:${expectedDigest}`);
   const after=await this.inspectInternal(signal),file=after.assets.find(asset=>asset.name===name);this.same(file,uploaded);
   readback=await this.downloadSelected(uploaded,signal);guard(readback.length===expectedSize&&sha256(readback)===expectedDigest);
   return {phase,assetId:uploaded.id,name,size:expectedSize,ciphertextDigest:expectedDigest,releaseId:this.manifest.releaseId,
    jobId:this.manifest.job.id,jobNonce:this.manifest.job.nonce,headSha:this.manifest.job.headSha,operationId:this.manifest.operationId,
    observedAt:new Date(this.now()).toISOString(),anonymousDraft404:true,anonymousAsset404:true,exactRetainedAssetVerified:true,readbackVerified:true,retryAllowed:false,paymentAccepted:false};
  }catch{return fail();}finally{owned?.fill(0);readback?.fill(0);}
 }
}
