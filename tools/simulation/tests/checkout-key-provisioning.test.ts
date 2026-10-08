// Inert CLI/source contract only. Never calls secret mutation or loads any key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
test('key provisioning CLI defaults to no IO and source has no reusable provider credential',()=>{
 const path=fileURLToPath(new URL('../scripts/provision-checkout-key.mjs',import.meta.url));
 const result=JSON.parse(execFileSync(process.execPath,[path],{encoding:'utf8'}));
 assert.deepEqual(result,{execute:false,externalWrites:0,paymentAuthority:false});
 const source=readFileSync(path,'utf8');
 assert.match(source,/windows-current-user-dpapi/);assert.match(source,/randomBytes\(32\)/);
 assert.match(source,/provision\.intent\.json/);assert.match(source,/maximumWrites:1/);
 assert.doesNotMatch(source,/\b[sr]k_(live|test)_[A-Za-z0-9]+/);
 assert.match(source,/secretValueReadbackAvailable:false/);assert.match(source,/providerCredentialsTransferred:false/);
});
