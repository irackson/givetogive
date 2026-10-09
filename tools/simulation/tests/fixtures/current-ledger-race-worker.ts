import { parentPort,workerData } from 'node:worker_threads';
import { SandboxLedger } from '../../src/sandbox-ledger.ts';
const ledger=new SandboxLedger(workerData.path,'public-race-run',2500,1500);
const barrier=new Int32Array(workerData.barrier);
try { parentPort!.postMessage({ready:true});Atomics.wait(barrier,0,0);
 let submitted=false;try{ledger.update('public-race-operation','submitted');submitted=true;}catch{/* Expected losing contender; no replay. */}
 parentPort!.postMessage({submitted});
}finally{ledger.close();}
