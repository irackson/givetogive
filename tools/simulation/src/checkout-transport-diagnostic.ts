/** Read-only nonfinancial diagnosis. No member, Stripe, SQL, ciphertext download,
 * financial admission or recovery replay. Existing transfer secret only. */
import { createHmac,timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { checkoutResponseBytes } from './checkout-input-mailbox.ts';
import { openSurfaceInspection } from './checkout-surface-inspection.ts';
import type { StripeCheckoutDriver } from './stripe-checkout-driver.ts';
const repository='irackson/givetogive';
const retained=Object.freeze({releaseId:407301835,assetId:623141370,head:'b976c74e2899d4c5ed49f3afb84848b959930041',
 name:'checkout-284c4f9d-6aec-4910-bbb2-ef7b1a9d2ff7-113565326479-1-ffebd4a021eb1f1918471d7e9fe4c5eb-input.g2genc',
 digest:'sha256:6ae137db7015ff3738c4db236d863ccc9286e8b44012b889f7ba83e4f897dc6d',size:1964});
const guard=(value:unknown)=>{if(!value)throw Error('Read-only Checkout transport diagnostic rejected.');};
export function checkoutTransferChallenge(key:Buffer,head:string,nonce:string) {
 guard(key.length===32&&/^[a-f0-9]{40}$/.test(head)&&/^[a-f0-9]{32}$/.test(nonce));
 return createHmac('sha256',key).update(`givetogive:nonfinancial-checkout-transport:v1:${head}:${nonce}`).digest('hex');
}
export function checkoutTransferChallengeMatches(key:Buffer,head:string,nonce:string,expected:string) {
 guard(/^[a-f0-9]{64}$/.test(expected));
 return timingSafeEqual(Buffer.from(checkoutTransferChallenge(key,head,nonce),'hex'),Buffer.from(expected,'hex'));
}
export function validateCheckoutDiagnosticContext(env:NodeJS.ProcessEnv,platform:string,nodeMajor:number) {
 guard(platform==='linux'&&nodeMajor===24&&env.GITHUB_REPOSITORY===repository&&env.GITHUB_ACTOR==='irackson'&&
  env.GITHUB_TRIGGERING_ACTOR==='irackson'&&env.GITHUB_EVENT_NAME==='workflow_dispatch'&&env.GITHUB_REF==='refs/heads/main'&&
  env.GITHUB_RUN_ATTEMPT==='1'&&env.GITHUB_JOB==='checkout-diagnostic');
 guard(!Object.keys(env).some(key=>/^(STRIPE_|DATABASE_|GOOGLE_|GMAIL_|RESEND_|NEXTAUTH_|AUTH_SECRET|SIM_CREDENTIALS|SIM_RUNNER|COMMUNITY_)/.test(key)));
 const config=z.object({head:z.string().regex(/^[a-f0-9]{40}$/),expectedHead:z.string().regex(/^[a-f0-9]{40}$/),
  nonce:z.string().regex(/^[a-f0-9]{32}$/),proof:z.string().regex(/^[a-f0-9]{64}$/),
  key:z.string().regex(/^[a-f0-9]{64}$/),token:z.string().min(20).max(4096)}).parse({head:env.GITHUB_SHA,
  expectedHead:env.CHECKOUT_EXPECTED_SHA,nonce:env.CHECKOUT_DIAGNOSTIC_NONCE,proof:env.CHECKOUT_DIAGNOSTIC_PROOF,
  key:env.CHECKOUT_BUNDLE_KEY,token:env.CHECKOUT_GITHUB_TOKEN});
 guard(config.head===config.expectedHead);return config;
}
export async function inspectCheckoutDiagnosticMetadata(token:string,signal:AbortSignal,request:typeof fetch=fetch) {
 guard(token.length>=20&&token.length<=4096&&!/[\r\n]/.test(token));
 const get=async(path:string,anonymous=false)=>request(`https://api.github.com/repos/${repository}/${path}`,{
  method:'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),
  headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10',...(anonymous?{}:{Authorization:`Bearer ${token}`})}});
 const read=async(path:string)=>{const response=await get(path);
  if(response.status!==200){void response.body?.cancel().catch(()=>undefined);throw Error('Private metadata unavailable.');}
  const bytes=await checkoutResponseBytes(response,262144,signal);
  try{return JSON.parse(bytes.toString('utf8')) as unknown;}finally{bytes.fill(0);}};
 const private404=async(path:string)=>{const response=await get(path,true);try{guard(response.status===404);}finally{void response.body?.cancel().catch(()=>undefined);}};
 const releasePath=`releases/${retained.releaseId}`,assetPath=`releases/assets/${retained.assetId}`;
 await private404(releasePath);await private404(assetPath);
 const assetSchema=z.object({id:z.literal(retained.assetId),name:z.literal(retained.name),size:z.literal(retained.size),digest:z.literal(retained.digest),state:z.literal('uploaded')});
 const release=z.object({id:z.literal(retained.releaseId),target_commitish:z.literal(retained.head),draft:z.literal(true),published_at:z.null(),assets:z.array(assetSchema).length(1)}).parse(await read(releasePath));
 const asset=assetSchema.parse(await read(assetPath));guard(asset.id===release.assets[0]!.id);
 await private404(releasePath);await private404(assetPath);
 return {privateDraftMetadataReadable:true,privateAssetMetadataReadable:true,anonymousAccessDenied:true,
  ciphertextDownloaded:false,originalInputChanged:false,financialReplay:false,paymentAccepted:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 let key:Buffer|undefined,phase='context';
 let driver: StripeCheckoutDriver | undefined;
 try {
  guard(process.argv.length===3&&process.argv[2]==='--execute-readonly');
  const config=validateCheckoutDiagnosticContext(process.env,process.platform,Number(process.versions.node.split('.')[0]));
  guard(execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'}).trim()===config.head);
  key=Buffer.from(config.key,'hex');delete process.env.CHECKOUT_BUNDLE_KEY;delete process.env.CHECKOUT_GITHUB_TOKEN;
  phase='transfer-key-match';guard(checkoutTransferChallengeMatches(key,config.head,config.nonce,config.proof));
  console.log(JSON.stringify({transferKeyMatchesLocal:true,secretValueWithheld:true,financialAuthority:false}));
  const encryptedSurface = process.env.CHECKOUT_SURFACE_PAYLOAD; delete process.env.CHECKOUT_SURFACE_PAYLOAD;
  if(encryptedSurface) {
   phase='read-only-input';const input=openSurfaceInspection(key,encryptedSurface,{head:config.head,nonce:config.nonce});
   phase='read-only-browser';const { StripeCheckoutDriver }=await import('./stripe-checkout-driver.ts');
   // No deployment bypass, normal member token, provider key or durable notice
   // admission enters this browser. Never call fill, submit, challenge or cancel.
   driver=new StripeCheckoutDriver('',input.email);
   await driver.open(input.checkout);
   const diagnostic=await driver.inspectSurface(30000);
   console.log(JSON.stringify({nativeLinuxSurfaceInspection:true,headSha:config.head,financialAuthority:false,
    financialActions:0,paymentAccepted:false,driver:diagnostic}));
  } else {
  phase='private-metadata';const metadata=await inspectCheckoutDiagnosticMetadata(config.token,AbortSignal.timeout(60000));
  console.log(JSON.stringify({nativeLinuxDiagnostic:true,headSha:config.head,...metadata}));
  }
 }catch{console.error(JSON.stringify({diagnosticFailed:true,phase,...(driver?{driver:driver.diagnostics()}:{}),privateDetailsWithheld:true,financialReplay:false,paymentAccepted:false}));process.exitCode=1;}
 finally{await driver?.close();key?.fill(0);}
}
