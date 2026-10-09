// CURRENT native Windows assembly. Default/import is inert. Original journals,
// one current decline only; no historical replay, grants, live mode or reset.
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const guard = value => { if (!value) throw Error('Current native operator stopped; originals and holds retained; no retry; private details withheld.'); };
export async function executeCurrentNativeOperator() {
 guard(process.platform === 'win32' && Number(process.versions.node.split('.')[0]) === 24);
 const { currentCheckoutCandidate: c, currentCheckoutSourceEvidence } = await import('../tools/simulation/src/checkout-current-profile.ts')
  .then(async value => ({ ...value, currentCheckoutSourceEvidence: (await import('../tools/simulation/src/checkout-current-preflight.ts')).currentCheckoutSourceEvidence }));
 const { inspectCurrentCheckoutPrerequisites } = await import('./checkout-current-operator-inspect.mjs');
 const { inspectLocalCheckoutRelease, recheckLocalCheckoutRelease } = await import('./checkout-release-inspect.mjs');
 // SOURCE gate comes before leases, key discovery, sign-in or remote mutations.
 const release = await inspectLocalCheckoutRelease(), head = release.headSha;
 let prerequisites = await inspectCurrentCheckoutPrerequisites();
 const { checkoutRunnerFiles } = await import('../tools/simulation/src/hosted-checkout-parent.ts');
 const git = args => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 16777216 });
 const hash = createHash('sha256');
 for (const name of checkoutRunnerFiles) hash.update(name).update('\0').update(git(['show', `${head}:tools/simulation/src/${name}`])).update('\0');
 hash.update('package-lock.json').update('\0').update(git(['show', `${head}:tools/simulation/package-lock.json`])).update('\0');
 for (const name of ['.github/workflows/checkout-staging.yml', '.github/workflows/checkout-current-staging.yml'])
  hash.update(name).update('\0').update(git(['show', `${head}:${name}`])).update('\0');
 const source = { canonicalSourceDigest: release.canonicalSourceDigest, rootLockDigest: release.rootLockDigest, runnerDigest: hash.digest('hex') };
 currentCheckoutSourceEvidence(source, head);
 const state = join(root, 'tools/simulation/.state'), run = join(state, 'runs', c.runId);
 for (const path of [state, run]) guard(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() && realpathSync(path) === path);
 const { validateSavedCredentials } = await import('../tools/simulation/src/provisioning.ts');
 const { validateSandboxPlan } = await import('../tools/simulation/src/sandbox-plan.ts');
 const credentials = validateSavedCredentials(JSON.parse(readFileSync(join(run, 'credentials.json'), 'utf8')),
  { runId: c.runId, mode: 'deterministic', origin: c.origin, databaseIdentity: c.databaseIdentity, population: 3 });
 const bytes = readFileSync(join(run, 'financial-plan.json')); let plan;
 try { guard(createHash('sha256').update(bytes).digest('hex') === c.planDigest); plan = validateSandboxPlan(JSON.parse(bytes.toString()), credentials); }
 finally { bytes.fill(0); }
 const member = credentials.agents.find(value => value.id === c.agentId);
 guard(member?.userId === c.memberId && member.email === c.memberEmail && member.password);
 const account = { id: member.id, userId: member.userId, email: member.email, password: member.password };
 const bypass = JSON.parse(readFileSync(join(state, 'protection.json'), 'utf8')).vercelProtectionBypass;
 guard(typeof bypass === 'string' && bypass.length >= 16);
 const directory = join(state, `current-native-${c.operationId}`); mkdirSync(directory, { mode: 0o700 });
 const { writeBootstrapOriginal } = await import('../tools/simulation/src/checkout-bootstrap-retention.ts');
 const original = (name, value, location = directory) => {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  try { writeBootstrapOriginal(location, name, data); } finally { if (!Buffer.isBuffer(value)) data.fill(0); }
 };
 original('operator-lease.json', { headSha: head, operationId: c.operationId, maximumMemberSignIns: 1, maximumPreparations: 1,
  maximumSubmissions: 1, noHistoryReset: true, paymentAccepted: false, retryAllowed: false });
 original('release.original.json', release); original('prerequisites.original.json', prerequisites.summary);
 const controller = new AbortController(), stop = () => controller.abort(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(1500000)]);
 let key, token, session, preparation, ledger, worker, broker, responder, input, failure = false;
 const { loadCheckoutTransferKey } = await import('../tools/simulation/scripts/provision-checkout-key.mjs');
 const { UiSession } = await import('../tools/simulation/src/ui-session.ts');
 const { UiCheckoutPreparation } = await import('../tools/simulation/src/ui-checkout-preparation.ts');
 const { SandboxLedger } = await import('../tools/simulation/src/sandbox-ledger.ts');
 const { dispatchCurrentCheckoutWorker } = await import('../tools/simulation/src/checkout-current-dispatch.ts');
 const { prepareCurrentCheckoutInput } = await import('../tools/simulation/src/checkout-current-prepare.ts');
 const { observeCurrentCheckoutJob } = await import('../tools/simulation/src/checkout-current-job.ts');
 const { observeCurrentCheckoutReadiness } = await import('../tools/simulation/src/checkout-current-readiness.ts');
 const { validateCurrentCheckoutProof } = await import('../tools/simulation/src/checkout-current-input.ts');
 const { deriveCurrentMemberIdentity } = await import('../tools/simulation/src/checkout-current-member.ts');
 const { CurrentCheckoutProofReader } = await import('../tools/simulation/src/checkout-current-provider.ts');
 const { CurrentCheckoutRootBroker } = await import('../tools/simulation/src/checkout-current-root.ts');
 const { CurrentCheckoutRootResponder } = await import('../tools/simulation/src/checkout-current-responder.ts');
 const { coordinateCurrentCheckout } = await import('../tools/simulation/src/checkout-current-coordinate.ts');
 const { stripeCheckoutReads } = await import('../tools/simulation/src/checkout-provider-proof.ts');
 const { unseal, fileBytes } = await import('../tools/simulation/src/hosted-community-bundle.ts');
 const { currentProfileDigest } = await import('../tools/simulation/src/checkout-current-phase.ts');
 process.on('SIGINT', stop); process.on('SIGTERM', stop);
 const targetFor = () => ({ headSha: head, workflowRunId: worker.workflowRunId, jobId: worker.observation.readiness.profile.job.jobId });
 const verifyCurrent = async scoped => {
  scoped.throwIfAborted(); await recheckLocalCheckoutRelease(release); scoped.throwIfAborted();
  if (session) await session.verifyIdentity();
  if (worker) {
   const job = await observeCurrentCheckoutJob(targetFor(), { token, signal: scoped }); guard(job.transportEvidence === 'github-live-current-job');
   await observeCurrentCheckoutReadiness(targetFor(), source, { token, signal: scoped, original: worker.observation });
  }
  scoped.throwIfAborted();
 };
 const financialBoundary = (noticeConsumed = false) => {
  const attempt = ledger?.get(c.operationId); guard(!attempt || ['reserved', 'submitted'].includes(attempt.state));
  return { headSha: head, financialState: attempt?.state ?? 'unadmitted', noticeConsumed };
 };
 try {
  key = loadCheckoutTransferKey(); const tokenBytes = execFileSync('gh', ['auth', 'token'], { cwd: root, windowsHide: true,
   stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 16384 });
  try { token = tokenBytes.toString().trim(); guard(token.length >= 20 && !/[\r\n]/.test(token)); } finally { tokenBytes.fill(0); }
  await verifyCurrent(signal); original('member-sign-in.intent.json', { maximumPosts: 1, actorId: c.memberId, retryAllowed: false });
  session = await UiSession.signIn(c.origin, account, bypass);
  worker = await dispatchCurrentCheckoutWorker({ root: directory, headSha: head, source, token, signal, verifyCurrent });
  guard(worker.nativeEvidence === 'github-live-current-dispatch');
  await verifyCurrent(signal); prerequisites = await inspectCurrentCheckoutPrerequisites();
  // ORIGINAL run paths exist and were SELECT-verified above. Never initialize a
  // fresh journal to evade expired/ambiguous holds.
  preparation = new UiCheckoutPreparation(join(run, 'financial-intents.sqlite'), plan);
  const { default: Stripe } = await import('stripe');
  guard(/^[sr]k_test_/.test(process.env.STRIPE_SECRET_KEY ?? ''));
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-08-26.dahlia', timeout: 15000, maxNetworkRetries: 0 });
  const reads = stripeCheckoutReads(stripe);
  const prepared = await prepareCurrentCheckoutInput(worker.observation.readiness, { root: directory, key, releaseId: worker.releaseId,
   account, stagingBypass: bypass, session, plan, preparation, draft: worker.draft, signal,
   retainOriginalRunIntent: async scoped => {
    await verifyCurrent(scoped);
    original(`ui-acceptance-${c.operationId}.intent.json`, { runId: c.runId, operationId: c.operationId, actorId: c.memberId,
     headSha: head, planDigest: c.planDigest, scenario: 'decline', maximumAmountCents: 500,
     createdAt: new Date().toISOString(), preparationOnly: true }, run);
   },
   observeCurrent: async (boundary, scoped) => {
    await verifyCurrent(scoped);
    prerequisites = await inspectCurrentCheckoutPrerequisites(boundary === 'unused' ? 'unused' : financialBoundary());
    const job = await observeCurrentCheckoutJob(targetFor(), { token, signal: scoped });
    const initial = worker.observation.readiness.profile;
    return { ...initial, job: { ...initial.job, observedAt: job.observedAt } }; // Original memory is not freshened.
   }, observeOpening: async (profile, scoped) => {
    scoped.throwIfAborted(); const target = prerequisites.target; guard(target.sessionId);
    const provider = await reads.checkout(target.sessionId); scoped.throwIfAborted();
    guard(provider.customer_account === target.customerAccountId && provider.client_reference_id === c.operationId && provider.livemode === false &&
     provider.amount_total === 500 && provider.currency === 'usd' && provider.mode === 'subscription' && provider.status === 'open' &&
     provider.payment_status === 'unpaid' && provider.invoice === null && provider.subscription === null && provider.payment_intent === null &&
     provider.success_url === `${c.origin}/giving/${c.operationId}?checkout=returned` && provider.cancel_url === `${c.origin}/giving/${c.operationId}?checkout=canceled`);
    return validateCurrentCheckoutProof({ platformAccountId: process.env.STRIPE_PLATFORM_ACCOUNT_ID, customerAccountId: target.customerAccountId,
     canonicalCustomerClockVerified: true, providerIdentityVerified: true, providerInvoiceAbsent: true, providerSubscriptionAbsent: true,
     checkout: { environment: 'staging', databaseIdentity: c.databaseIdentity, runId: c.runId, operationId: c.operationId, actorId: c.memberId,
      sessionId: target.sessionId, url: provider.url, livemode: false, currency: 'usd', amountTotal: 500, mode: 'subscription', status: 'open',
      paymentStatus: 'unpaid', expiresAt: provider.expires_at, returnOrigin: c.origin, verifiedAt: new Date().toISOString() } }, profile, Date.now());
   } });
  input = prepared.input;
  ledger = new SandboxLedger(join(run, 'financial-attempts.sqlite'), c.runId, 2500, 1500);
  const { customerAccountId, clockId, frozenTime, sessionId } = prerequisites.target;
  const reader = new CurrentCheckoutProofReader(input, { customerAccountId, clockId, frozenTime, sessionId }, reads);
  const readMember = async (proof, scoped) => {
   const read = async () => { scoped.throwIfAborted(); const response = await session.context.get(`${c.origin}/api/auth/session`, { maxRedirects: 0, maxRetries: 0 });
    try { guard(response.ok() && response.url() === `${c.origin}/api/auth/session`); return await response.json(); } finally { await response.dispose(); } };
   const before = await read(), availability = await session.query('billing.availability', undefined), overview = await session.query('billing.myOverview', undefined),
    subscriptions = await session.query('billing.mySubscriptions', undefined), payment = await session.query('billing.payment', { id: c.operationId }), after = await read();
   scoped.throwIfAborted(); return deriveCurrentMemberIdentity(before, after, availability, overview, subscriptions, payment, proof, Date.now());
  };
  broker = new CurrentCheckoutRootBroker(input, { root: directory, key, ledger, reader, verifyCurrent: (__phase, scoped) => verifyCurrent(scoped),
   verifyOriginalBudget: async (__phase, scoped, noticeConsumed) => {
    scoped.throwIfAborted(); await inspectCurrentCheckoutPrerequisites(financialBoundary(noticeConsumed)); scoped.throwIfAborted();
   }, readMember });
  responder = new CurrentCheckoutRootResponder(input, { root: directory, key, connectionNonce: prepared.connectionNonce,
   releaseId: worker.releaseId, broker, transport: worker.draft, verifyContext: verifyCurrent });
  const binding = { releaseId: worker.releaseId, operationId: c.operationId,
   job: { id: input.profile.job.jobId, nonce: input.profile.job.jobNonce, headSha: head } };
  const result = await coordinateCurrentCheckout({ binding, transport: worker.draft, responder, verifyContext: verifyCurrent, signal });
  original('coordination.result.json', result);
 } catch { failure = true; }
 finally {
  try {
   if (worker && key) {
    original('final-download.intent.json', { maximumDownloads: 1, paymentAccepted: false, retryAllowed: false });
    const final = await worker.draft.download('final', AbortSignal.timeout(180000));
    try {
     original('final.original.g2genc', final); const decoded = unseal(final, key, 4194304), initial = worker.observation.readiness.profile;
     guard(decoded?.protocol === 1 && decoded.purpose === 'current-checkout-native-originals' && decoded.profileDigest === currentProfileDigest(initial) &&
      decoded.binding?.releaseId === worker.releaseId && decoded.binding.operationId === c.operationId && decoded.binding.job?.id === initial.job.jobId &&
      decoded.binding.job.nonce === initial.job.jobNonce && decoded.binding.job.headSha === head && decoded.paymentAccepted === false &&
      decoded.retryAllowed === false && decoded.independentClosureAndSettlementRequired === true && Array.isArray(decoded.files) && decoded.files.length > 0);
     for (const file of decoded.files) { const bytes = fileBytes(file); bytes.fill(0); }
     original('final-recovery.result.json', { originalRetained: true, authenticatedDecryption: true,
      ciphertextDigest: createHash('sha256').update(final).digest('hex'), paymentAccepted: false, independentClosureAndSettlementRequired: true, retryAllowed: false });
    } finally { final.fill(0); }
   }
  } catch { failure = true; }
  for (const resource of [responder, broker, ledger, preparation]) try { resource?.close(); } catch { failure = true; }
  try { await session?.close(); } catch { failure = true; }
  key?.fill(0); token = undefined; input = undefined;
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
 }
 guard(!failure);
 return { nativeOperatorFinished: true, privateFinalRetained: true, independentClosureAndSettlementRequired: true, paymentAccepted: false, retryAllowed: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  if (process.argv.length === 3 && process.argv[2] === '--execute-reviewed-current') console.log(JSON.stringify(await executeCurrentNativeOperator()));
  else { guard(process.argv.length === 2); console.log(JSON.stringify({ execute: false, externalRequests: 0, checkoutCreated: false, paymentAccepted: false })); }
 } catch { console.error('Current native operator stopped; originals and holds retained; no retry; private details withheld.'); process.exitCode = 1; }
}
