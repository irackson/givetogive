// Only substitute the server-only marker and the existing pool leaf. All
// application receipt/transaction code and PostgreSQL commands execute intact.
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
  if(specifier==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};
  if(specifier==='@/server/db')return {url:'data:text/javascript,export const db=globalThis.__GIVE_NATIVE_FIXTURE_DB__;',shortCircuit:true};
  return next(specifier,context);
}});
