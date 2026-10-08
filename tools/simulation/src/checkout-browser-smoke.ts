/** Credential-free preflight in the dedicated Checkout workflow. Do not forge
 * the community workflow identity or expose credentials to its smoke child. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approved } from './hosted-checkout-policy.ts';
import { browserSmoke } from './hosted-community.ts';
export function validateCheckoutSmokeContext(env: NodeJS.ProcessEnv, platform: string, nodeMajor: number) {
 if(platform!=='linux'||nodeMajor!==24||env['GITHUB_REPOSITORY']!==approved.repository||env['GITHUB_ACTOR']!==approved.actor||
  env['GITHUB_TRIGGERING_ACTOR']!==approved.actor||env['GITHUB_EVENT_NAME']!=='workflow_dispatch'||env['GITHUB_REF']!=='refs/heads/main'||
  env['GITHUB_RUN_ATTEMPT']!=='1'||env['GITHUB_JOB']!=='checkout-parent'||!/^[a-f0-9]{40}$/.test(env['GITHUB_SHA']??'')||
  ['CHECKOUT_BUNDLE_KEY','CHECKOUT_GITHUB_TOKEN','COMMUNITY_BUNDLE_KEY','COMMUNITY_RECOVERY_TOKEN','STRIPE_SECRET_KEY','DATABASE_URL','SIM_CREDENTIALS'].some(key=>env[key]))
  throw Error('Dedicated Checkout credential-free browser preflight rejected.');
 return env['GITHUB_SHA']!;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  if(process.argv.length!==3||process.argv[2]!=='--execute-credential-free')throw Error('Rejected');
  const head=validateCheckoutSmokeContext(process.env,process.platform,Number(process.versions.node.split('.')[0]));
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==head)throw Error('Rejected');
  await browserSmoke();
 }catch{console.error('Dedicated Checkout credential-free browser preflight rejected.');process.exitCode=1;}
}
