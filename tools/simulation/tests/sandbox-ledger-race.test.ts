import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxLedger } from '../src/sandbox-ledger.ts';
test('two real SQLite contenders admit submission exactly once and preserve the existing hold',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'g2g-ledger-race-')),'original.sqlite');
 const ledger=new SandboxLedger(path,'public-race-run',2500,1500);ledger.reserve('public-race-operation','public-race-member',500,'decline');
 const barrier=new SharedArrayBuffer(4),workers:Worker[]=[];let ready=0;
 try{
  const results=await Promise.all([0,1].map(()=>new Promise<boolean>((resolve,reject)=>{
   const worker=new Worker(new URL('./fixtures/current-ledger-race-worker.ts',import.meta.url),{workerData:{path,barrier}});workers.push(worker);
   let answered=false;const timeout=setTimeout(()=>reject(Error('Ledger concurrency test timed out')),10000);
   worker.on('error',reject);worker.on('exit',code=>{clearTimeout(timeout);if(code!==0||!answered)reject(Error('Ledger worker did not finish'));});
   worker.on('message',(value:{ready?:boolean;submitted?:boolean})=>{if(value.ready){if(++ready===2){Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0,2);}}
    else if(typeof value.submitted==='boolean'){answered=true;resolve(value.submitted);}});
  })));
  assert.equal(results.filter(Boolean).length,1);assert.equal(ledger.get('public-race-operation')?.state,'submitted');assert.equal(ledger.report().length,1);
  assert.throws(()=>ledger.update('public-race-operation','submitted'));assert.equal(ledger.get('public-race-operation')?.amountCents,500);
 }finally{await Promise.all(workers.map(worker=>worker.terminate()));ledger.close();}
});
