// Local read-only release verification. Import/default is inert; no relink,
// deploy, environment change, secret dump, member login or payment action.
import { execFileSync, execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { releaseSourceDigest } from './release-rehearsal-fingerprint.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = 'C:/Users/Ian/AppData/Local/pnpm/global/v11/9538-1a03bddf05f-5e68638a8374958f/node_modules/vercel/dist/vc.js';
const team = 'team_TXid48wU77cfhEg28L3EyLpn', projectId = 'prj_HvlFV1kKHVsML73nlsJAFQNA7grP';
// Reviewed October 9 15:19 UTC controlled protected staging upload; old financial source approvals
// remain historical. This read-only binding never authorizes a payment retry.
export const checkoutReleaseBinding = Object.freeze({
 deploymentId: 'dpl_BjjNh1yYuzNyXHLPhdja6k2xwS7X',
 appSha: 'c8044c1b9dae433b2d598f39f84e6897dd87c546',
 canonicalSourceDigest: 'caaf7bee5cee2467f3c7d4c0dc2ac7e717dbb544c7aedf09d3e4a5f82b63ad6e',
 sourceDigest: '3be484ab5cb5a9e65cd7913397f0fd2df8702b9cbb269952b1e619e59642504f',
 lockDigest: '71ee2fb1a9ad63638e941cf94d51edc76265c964a9c7a686d07833f9c8f73def',
 uploadDigest: '25537c552a597bcd2323e2c292a705ece21ef7f05f75c64bdd447c161be65493',
});
const { deploymentId, appSha } = checkoutReleaseBinding;
const origin = 'https://givetogive-staging.vercel.app';
const names = ['src','public','package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.js','postcss.config.cjs','tailwind.config.ts'];
const guard = value => { if (!value) throw Error('Checkout staging release unconfirmed; private details withheld.'); };
const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'], timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
export function releaseCliArguments(args) {
 // CLI 59.5.0 forwards --non-interactive to native curl even before the
 // separator. Curl uses the CLI's detected agent mode and exact --deployment;
 // do not add --yes, relink, or approve new protection access as a workaround.
 return args[0] === 'curl' ? [cli, ...args] : [cli, '--non-interactive', ...args];
}
function vcReadAsync(args) {
 return new Promise((accept, reject) => execFile(process.execPath, releaseCliArguments(args), {
  cwd: root, windowsHide: true, encoding: 'buffer', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
 }, (error, stdout, stderr) => { stderr.fill(0); if (error) { stdout.fill(0); reject(Error('Release read failed; private details withheld.')); }
  else accept(stdout); }));
}
async function apiReadAsync(path) {
 const bytes = await vcReadAsync(['api', `${path}?teamId=${team}`, '--raw']);
 try { return JSON.parse(bytes.toString('utf8')); } finally { bytes.fill(0); }
}
/** Pure coordination, not native verification or financial authority. Each
 * target remains explicit; the native caller validates all three snapshots. */
export function parallelReleaseMetadataReads(read) {
 return Promise.all([read(`/v9/projects/${projectId}`), read(`/v13/deployments/${deploymentId}`),
  read('/v4/aliases/givetogive-staging.vercel.app')]);
}
const linkDigest = () => createHash('sha256').update(readFileSync(resolve(root, '.vercel/project.json'))).digest('hex');
const verifiedSnapshots = new WeakSet();
/** Pure metadata check; READY, project/alias and runtime are checked separately. */
export function matchesReviewedCheckoutUpload(metadata) {
 return metadata?.githubCommitSha === appSha && metadata?.githubOrg === 'irackson' &&
  metadata?.githubRepo === 'givetogive' &&
  metadata?.verificationAuthoredSourceDigest === checkoutReleaseBinding.sourceDigest &&
  metadata?.verificationLockDigest === checkoutReleaseBinding.lockDigest &&
  metadata?.verificationSourceDigest === checkoutReleaseBinding.uploadDigest;
}
export async function inspectLocalCheckoutRelease() { return inspectRelease(); }
/** Only a full native observation from this process may enable the fast check.
 * Preserve its source observation time; refreshing hosting gates is not fresh
 * source approval, provider proof or hosted free-memory evidence. */
export async function recheckLocalCheckoutRelease(original) {
 guard(original && verifiedSnapshots.has(original));
 return inspectRelease(original);
}
async function inspectRelease(original) {
 let phase = 'local-source';
 try {
  const observedAt = new Date().toISOString();
  guard(process.platform === 'win32' && Number(process.versions.node.split('.')[0]) === 24);
  const head = git(['rev-parse','HEAD']).toString().trim(); guard(/^[a-f0-9]{40}$/.test(head));
  guard(git(['branch','--show-current']).toString().trim() === 'main' &&
   git(['status','--porcelain','--untracked-files=no']).toString().trim() === '');
  git(['verify-commit', head]);
  if (original) guard(head === original.headSha && releaseSourceDigest(root) === original.sourceDigest);
  const contextDigest = linkDigest(); if (original) guard(contextDigest === original.contextDigest);
  // Different tooling commits may use the SAME authored application. Verify the
  // actual app bytes, not equality between the runner and deployed Git SHAs.
  guard(git(['diff','--name-only', appSha, head, '--', ...names]).toString().trim() === '');
  const hash = createHash('sha256');
  function visit(path) {
   if (path === 'src/app/.well-known/workflow' || path.startsWith('src/app/.well-known/workflow/')) return;
   const type = git(['cat-file','-t',`${head}:${path}`]).toString().trim();
   if (type === 'tree') {
    const rows = git(['ls-tree','-z',`${head}:${path}`]).toString().split('\0').filter(Boolean).map(row => {
     const [metadata, name] = row.split('\t'); guard(!metadata.startsWith('120000 ')); return name; });
    for (const name of rows.sort()) visit(`${path}/${name}`);
   } else { guard(type === 'blob'); hash.update(path).update('\0').update(git(['show',`${head}:${path}`])).update('\0'); }
  }
  if (!original) for (const name of names) if (git(['ls-tree','--name-only',head,'--',name]).toString().trim()) visit(name);
  const canonicalSourceDigest = original ? original.canonicalSourceDigest : hash.digest('hex');
  const rootLockDigest = createHash('sha256').update(git(['show',`${head}:package-lock.json`])).digest('hex');
  guard(canonicalSourceDigest === checkoutReleaseBinding.canonicalSourceDigest &&
   rootLockDigest === checkoutReleaseBinding.lockDigest &&
   releaseSourceDigest(root) === checkoutReleaseBinding.sourceDigest);
  // Explicit context inspection; never rewrite the checkout's production link.
  phase = 'hosting-metadata';
  // Explicit initial native context remains bound by the unchanged local link
  // and process-owned original. No relink, metadata cache, stale gate or new
  // credential path. Independent current provider reads run concurrently.
  if (!original) { const bytes = await vcReadAsync(['project','inspect','givetogive-staging','--scope',team]); bytes.fill(0); }
  const [project, deployment, alias] = await parallelReleaseMetadataReads(apiReadAsync);
  guard(project.id === projectId && project.name === 'givetogive-staging' && project.accountId === team && project.nodeVersion === '24.x' &&
   project.ssoProtection?.deploymentType === 'all' && deployment.id === deploymentId && deployment.projectId === projectId &&
   deployment.readyState === 'READY' && deployment.nodeVersion === '24.x' && matchesReviewedCheckoutUpload(deployment.meta) &&
   alias.projectId === projectId && alias.deployment?.id === deploymentId);
  phase = 'protected-runtime-read';
  const bytes = await vcReadAsync(['curl','/api/trpc/billing.availability','--deployment',origin,'--scope',team,'--','--silent','--show-error','--fail','--max-time','20']);
  let availability;
  try { const value = JSON.parse(bytes.toString('utf8')); availability = value.result?.data?.json; } finally { bytes.fill(0); }
  phase = 'runtime-gates';
  guard(availability?.environment === 'staging' && availability.livemode === false && availability.subscriptions === true &&
   availability.askPayments === false && availability.funds === false && availability.billingManagement === true &&
   typeof process.env.STRIPE_PUBLISHABLE_KEY === 'string' && /^pk_test_/.test(process.env.STRIPE_PUBLISHABLE_KEY) &&
   availability.publishableKey === process.env.STRIPE_PUBLISHABLE_KEY);
  // Reobserve the alias after runtime observation; no stale promotion assumption.
  phase = 'final-binding';
  const after = await apiReadAsync('/v4/aliases/givetogive-staging.vercel.app');
  guard(after.projectId === projectId && after.deployment?.id === deploymentId &&
   git(['rev-parse','HEAD']).toString().trim() === head && git(['status','--porcelain','--untracked-files=no']).toString().trim() === '');
  const result = Object.freeze({ observedAt, sourceObservedAt: original ? original.sourceObservedAt : observedAt,
   headSha: head, deploymentId, deployedAppSha: appSha, canonicalSourceDigest, rootLockDigest,
   sourceDigest: releaseSourceDigest(root), contextDigest, ready: true, protected: true, nodeVersion: '24.x',
   runtimeGatesVerified: true, publishableKeyMatchesLocal: true, deployedCanonicalAppMatchesHead: true,
   sourceApprovalStillRequired: true, financialAdmission: false, databaseWrites: 0, memberActions: 0, paymentAccepted: false });
  verifiedSnapshots.add(result); return result;
 } catch { throw Error(`Checkout staging release unconfirmed; private details withheld; stage=${phase}.`); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  if (process.argv.length === 3 && process.argv[2] === '--inspect-readonly') console.log(JSON.stringify(await inspectLocalCheckoutRelease()));
  else { guard(process.argv.length === 2); console.log(JSON.stringify({ execute: false, externalRequests: 0, financialAdmission: false })); }
 } catch (error) {
  const match = /stage=(local-source|hosting-metadata|protected-runtime-read|runtime-gates|final-binding)\./.exec(error.message ?? '');
  console.error(`Checkout staging release unconfirmed; private details withheld${match ? `; stage=${match[1]}` : ''}.`); process.exitCode = 1;
 }
}
