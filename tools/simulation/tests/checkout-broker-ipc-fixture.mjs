// Offline child fixture: explicitly launched by tests, no env/provider/browser access.
import { createCheckoutBrokerClient } from '../src/checkout-broker-ipc.ts';
import { digest } from '../src/hosted-checkout-policy.ts';
const input=process.argv[2]?JSON.parse(process.argv[2]):undefined;
const binding=input?.binding??{manifestDigest:'a'.repeat(64),connectionNonce:'b'.repeat(32)};
const client=createCheckoutBrokerClient(process,binding,3000);
const signal=new AbortController().signal;
try{
 const proof=await client.preSubmitProof(signal);
 const intent={...(input?.intent??{}),phase:'submit-intent',manifestDigest:binding.manifestDigest,proofDigest:digest(proof)};
 const durable=await client.writeIntent(intent,signal);
 const retained=await client.retainSubmitIntent(intent,durable,signal);
 const credentialEnvironmentAbsent=!Object.keys(process.env).some(name=>/STRIPE|DATABASE_URL|GITHUB_TOKEN|ADMIN_ENCRYPTION|SECRET/i.test(name));
 process.send({fixtureComplete:true,ciphertextDigest:retained.ciphertextDigest,credentialEnvironmentAbsent},()=>{client.close();process.disconnect();});
}catch{client.close();process.disconnect();process.exitCode=1;}
