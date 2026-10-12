// Test-only marker/leaf substitution. No DB, provider or credential access.
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
/** @type {{runtime: import('../../src/server/mail/runtime.ts').GiveToGiveMailRuntime|undefined, env: Record<string,string|undefined>, captured: Record<string,unknown>[], sealCount:number}} */
export const fixture = { runtime: undefined, env: {}, captured: [], sealCount: 0 };
Object.defineProperty(globalThis, '__GIVE_MAIL_PUBLIC_FIXTURE__', { value: fixture });
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
/** @param {string} text */
const data = text => 'data:text/javascript,' + encodeURIComponent(text);
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier==='server-only')return {url:data('export{}'),shortCircuit:true};
  if(specifier==='@/env')return {url:data('export const env=globalThis.__GIVE_MAIL_PUBLIC_FIXTURE__.env;'),shortCircuit:true};
  if(specifier==='@/server/db')return {url:data('export const db={insert:()=>({values:async(value)=>{globalThis.__GIVE_MAIL_PUBLIC_FIXTURE__.captured.push(value);}})};'),shortCircuit:true};
  if(specifier==='@/server/db/operations-schema')return {url:data('export const emailSink={};'),shortCircuit:true};
  if(specifier==='@/server/security/crypto')return {url:data('export function sealSecret(){globalThis.__GIVE_MAIL_PUBLIC_FIXTURE__.sealCount++;return "SYNTHETIC-SEALED-URL";}'),shortCircuit:true};
  if(specifier==='./runtime.ts'&&context.parentURL?.endsWith('/give-mailer.ts'))return {url:data('export function getGiveToGiveMailRuntime(){return globalThis.__GIVE_MAIL_PUBLIC_FIXTURE__.runtime;}'),shortCircuit:true};
  if(specifier.startsWith('@/'))return {url:pathToFileURL(path.join(source,specifier.slice(2)+'.ts')).href,shortCircuit:true};
  return nextResolve(specifier,context);
}});
