// CURRENT native Windows assembly. Default/import is inert. Original journals,
// one current decline only; no historical replay, grants, live mode or reset.
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
const root = fileURLToPath(new URL('../', import.meta.url));
const guard = value => { if (!value) throw Error('Current native operator stopped; originals and holds retained; no retry; private details withheld.'); };
export async function executeCurrentNativeOperator(recovery = 'none') {
 guard(['none', 'predispatch', 'readiness'].includes(recovery));
 const predispatchRecovery = recovery === 'predispatch', readinessRecovery = recovery === 'readiness';
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
 let recoveryProof;
 if (predispatchRecovery) {
  const { readPredispatchRecovery } = await import('./checkout-predispatch-recovery.mjs');
  recoveryProof = readPredispatchRecovery(join(state, `current-native-${c.operationId}`), c.operationId, c.memberId);
  // Independent authenticated GitHub observations, never caller-provided flags.
  const bytes = execFileSync('gh', ['auth', 'token'], {windowsHide:true,stdio:['ignore','pipe','pipe']});
  let token;try{token=bytes.toString().trim();}finally{bytes.fill(0);}
  try {
   const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};
   const absent=await fetch(`https://api.github.com/repos/irackson/givetogive/releases/tags/checkout-current-${c.operationId}`,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
   guard(absent.status===404);await absent.body?.cancel();
   const history=await fetch('https://api.github.com/repos/irackson/givetogive/actions/workflows/checkout-current-staging.yml/runs?event=workflow_dispatch&branch=main&per_page=100',{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
   guard(history.ok);const runs=await history.json();guard(runs.total_count===0&&Array.isArray(runs.workflow_runs)&&runs.workflow_runs.length===0);
  }finally{token=undefined;}
 prerequisites=await inspectCurrentCheckoutPrerequisites();
 }
 if (readinessRecovery) {
  const { readReadinessRecovery, observeReadinessRecoveryRemote, readinessRecoveryBinding: b } = await import('./checkout-readiness-recovery.mjs');
  recoveryProof = readReadinessRecovery(join(state, `current-native-${c.operationId}-predispatch-recovery-v1`), c.operationId, c.memberId);
  // The passed diagnostic's browser owner/member launch implementation must be
  // unchanged. Transport naming can change, but readiness is not simulated.
  guard(git(['diff','--name-only',b.diagnosticHead,head,'--','tools/simulation/src/checkout-current-parent.ts',
   'tools/simulation/src/checkout-process-observation.ts','tools/simulation/src/checkout-current-member-entry.mjs']).toString().trim()==='');
  const bytes=execFileSync('gh',['auth','token'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let githubToken;
  try{githubToken=bytes.toString().trim();}finally{bytes.fill(0);}
  try {
   const remote=await observeReadinessRecoveryRemote(recoveryProof.priorReleaseId,c.operationId,githubToken);
   guard(remote.transportEvidence==='github-live-readiness-recovery');
  }finally{githubToken=undefined;}
  prerequisites=await inspectCurrentCheckoutPrerequisites();
 }
 const directory = join(state, `current-native-${c.operationId}${predispatchRecovery ? '-predispatch-recovery-v1' : readinessRecovery ? '-readiness-recovery-v1' : ''}`); mkdirSync(directory, { mode: 0o700 });
 const { writeBootstrapOriginal } = await import('../tools/simulation/src/checkout-bootstrap-retention.ts');
 const original = (name, value, location = directory) => {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  try { writeBootstrapOriginal(location, name, data); } finally { if (!Buffer.isBuffer(value)) data.fill(0); }
 };
 original('operator-lease.json', { headSha: head, operationId: c.operationId, maximumMemberSignIns: 1, maximumPreparations: 1,
  maximumSubmissions: 1, noHistoryReset: true, paymentAccepted: false, retryAllowed: false });
 original('release.original.json', release); original('prerequisites.original.json', prerequisites.summary);
 if(recoveryProof)original(readinessRecovery?'readiness-recovery.original.json':'predispatch-recovery.original.json',recoveryProof);
 const controller = new AbortController(), stop = () => controller.abort(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(1500000)]);
 let key, token, session, preparation, ledger, worker, broker, responder, input, stripe, finalizationSnapshot, finalizationReady = false, declineVerified = false, failure = false;
 const { loadCheckoutTransferKey } = await import('../tools/simulation/scripts/provision-checkout-key.mjs');
 const { UiSession } = await import('../tools/simulation/src/ui-session.ts');
 const { UiCheckoutPreparation } = await import('../tools/simulation/src/ui-checkout-preparation.ts');
 const { SandboxLedger } = await import('../tools/simulation/src/sandbox-ledger.ts');
 const { dispatchCurrentCheckoutWorker } = await import('../tools/simulation/src/checkout-current-dispatch.ts');
 const { prepareCurrentCheckoutInput } = await import('../tools/simulation/src/checkout-current-prepare.ts');
 const { observeCurrentCheckoutJob } = await import('../tools/simulation/src/checkout-current-job.ts');
 const { observeCurrentCheckoutFinalJob } = await import('../tools/simulation/src/checkout-current-final-job.ts');
 const { observeCurrentCheckoutReadiness } = await import('../tools/simulation/src/checkout-current-readiness.ts');
 const { validateCurrentCheckoutProof } = await import('../tools/simulation/src/checkout-current-input.ts');
 const { deriveCurrentMemberIdentity } = await import('../tools/simulation/src/checkout-current-member.ts');
 const { CurrentCheckoutProofReader } = await import('../tools/simulation/src/checkout-current-provider.ts');
 const { CurrentCheckoutRootBroker } = await import('../tools/simulation/src/checkout-current-root.ts');
 const { CurrentCheckoutRootResponder } = await import('../tools/simulation/src/checkout-current-responder.ts');
 const { coordinateCurrentCheckout } = await import('../tools/simulation/src/checkout-current-coordinate.ts');
 const { stripeCheckoutReads } = await import('../tools/simulation/src/checkout-provider-proof.ts');
 const { unseal } = await import('../tools/simulation/src/hosted-community-bundle.ts');
 const { validateCurrentFinalEvidence } = await import('../tools/simulation/src/checkout-current-final-evidence.ts');
 const { observeCurrentProviderDecline } = await import('../tools/simulation/src/checkout-current-decline.ts');
 const { verifyCurrentDeclineAppSnapshot } = await import('../tools/simulation/src/checkout-current-app-decline.ts');
 const { observeCurrentFailureEvents } = await import('../tools/simulation/src/checkout-current-failure-event.ts');
 const { inspectCurrentDeclineApp } = await import('./checkout-current-app-inspect.mjs');
 const { inspectPreparedCheckoutCandidateBudget } = await import('../tools/simulation/src/checkout-prepared-budget.ts');
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
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-08-26.dahlia', timeout: 15000, maxNetworkRetries: 0 });
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
  const verifyFinalContext = async scoped => {
   await recheckLocalCheckoutRelease(release); await session.verifyIdentity();
   const finalSignal = AbortSignal.any([scoped, AbortSignal.timeout(60000)]);
   for (;;) {
    const observed = await observeCurrentCheckoutFinalJob(targetFor(), { token, signal: finalSignal });
    guard(observed.transportEvidence === 'github-live-current-final-job');
    if (observed.runFinished) { guard(observed.successful); break; }
    await sleep(2000, undefined, { signal: finalSignal });
   }
   await recheckLocalCheckoutRelease(release); finalSignal.throwIfAborted();
  };
  const result = await coordinateCurrentCheckout({ binding, transport: worker.draft, responder, verifyContext: verifyCurrent, verifyFinalContext, signal });
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
     guard(input);
     const uploadIntent = JSON.parse(readFileSync(join(directory, `current-root-input-${c.operationId}-${initial.job.jobId}-${initial.job.jobNonce}`, 'input-upload.intent.json'), 'utf8'));
     const validated = validateCurrentFinalEvidence(decoded, { profile: initial, connectionNonce: worker.observation.readiness.connectionNonce,
      inputProfileDigest: input.profileDigest, inputCiphertextDigest: uploadIntent.ciphertextDigest, releaseId: worker.releaseId });
     original('final-evidence-validation.result.json', validated);
     // Retain a read-only exact provider graph after authenticated final evidence.
     // This never marks the original financial journal accepted or releases holds.
     guard(stripe && ledger?.get(c.operationId)?.state === 'submitted');
     original('provider-decline-observation.intent.json', { operationId: c.operationId, maximumObservations: 1, paymentAccepted: false, retryAllowed: false });
     const decline = await observeCurrentProviderDecline({ operationId: c.operationId, sessionId: input.proof.checkout.sessionId,
      customerAccountId: input.proof.customerAccountId, origin: c.origin }, {
      checkout: id => stripe.checkout.sessions.retrieve(id), invoice: id => stripe.invoices.retrieve(id),
      invoicePayments: id => stripe.invoicePayments.list({ invoice: id, limit: 10 }), paymentIntent: id => stripe.paymentIntents.retrieve(id),
     }, AbortSignal.timeout(30000));
     original('provider-decline-observation.result.json', decline);
     original('app-decline-observation.intent.json', { operationId: c.operationId, readOnly: true, paymentAccepted: false, retryAllowed: false });
     await recheckLocalCheckoutRelease(release); await session.verifyIdentity();
     const cookieSession = async () => {
      const response = await session.context.get(`${c.origin}/api/auth/session`, { maxRedirects: 0, maxRetries: 0 });
      try { guard(response.ok() && response.url() === `${c.origin}/api/auth/session`); return await response.json(); } finally { await response.dispose(); }
     };
     const before = await cookieSession(), availability = await session.query('billing.availability', undefined),
      overview = await session.query('billing.myOverview', undefined), subscriptions = await session.query('billing.mySubscriptions', undefined),
      payment = await session.query('billing.payment', { id: c.operationId });
     const database = await inspectCurrentDeclineApp({ sessionId: input.proof.checkout.sessionId, customerAccountId: input.proof.customerAccountId,
      invoiceId: decline.invoiceId, paymentIntentId: decline.paymentIntentId });
     const after = await cookieSession();
     const app = verifyCurrentDeclineAppSnapshot({ before, after, availability, overview, subscriptions, payment, database });
     const budget = inspectPreparedCheckoutCandidateBudget(run, c.planDigest, credentials, c.operationId,
      { headSha: head, financialState: 'submitted', noticeConsumed: validated.noticeRequests === 1 });
     original('app-decline-observation.result.json', app); original('original-submitted-budget.result.json', budget);
     if (decline.providerDeclineObserved) {
      original('failure-event-observation.intent.json', { maximumObservations: 1, paymentAccepted: false, retryAllowed: false });
      // Root-only fresh native identity/clock reads; these are never worker keys.
      const nativeReads = stripeCheckoutReads(stripe), platform = await nativeReads.platform(), balance = await nativeReads.balance(),
       customer = await nativeReads.customer(input.proof.customerAccountId), clock = await nativeReads.clock(prerequisites.target.clockId);
      guard(platform.id === process.env.STRIPE_PLATFORM_ACCOUNT_ID && balance.livemode === false && customer.id === input.proof.customerAccountId &&
       customer.livemode === false && customer.configuration?.customer?.test_clock === prerequisites.target.clockId &&
       clock.id === prerequisites.target.clockId && clock.name === `givetogive:${c.runId}` && clock.livemode === false &&
       clock.status === 'ready' && clock.frozen_time === prerequisites.target.frozenTime);
      const events = await observeCurrentFailureEvents({ platformAccountId: platform.id, customerAccountId: customer.id,
       invoiceId: decline.invoiceId, paymentIntentId: decline.paymentIntentId }, database.failureEvents,
       id => stripe.events.retrieve(id), AbortSignal.timeout(30000));
      original('failure-event-observation.result.json', events);
      // Every observation above is native in this entrypoint; injected/pure
      // observers never receive original journal finalization authority.
      finalizationReady = !failure && events.processedFailureEventCorrelated && !events.webhookProcessingPending &&
       !app.webhookProcessingPending && app.normalMemberNeighborObserved && app.canonicalDatabaseNoPaidEntitlementObserved &&
       validated.authenticatedOriginalBindingsValidated && validated.recordedNativeClosureValidated && budget.financialState === 'submitted';
      if (finalizationReady) finalizationSnapshot = { before, after, availability, overview, subscriptions, payment,
       invoiceId: decline.invoiceId, paymentIntentId: decline.paymentIntentId, noticeConsumed: validated.noticeRequests === 1 };
     }
     original('final-recovery.result.json', { originalRetained: true, authenticatedDecryption: true,
      ciphertextDigest: createHash('sha256').update(final).digest('hex'), paymentAccepted: false, independentClosureAndSettlementRequired: true, retryAllowed: false });
    } finally { final.fill(0); }
   }
  } catch { failure = true; }
  for (const resource of [responder, broker, preparation]) try { resource?.close(); } catch { failure = true; }
  try { await session?.close(); } catch { failure = true; }
  try {
   if (!failure && finalizationReady) {
    signal.throwIfAborted(); await recheckLocalCheckoutRelease(release);
    const job = await observeCurrentCheckoutFinalJob(targetFor(), { token, signal: AbortSignal.timeout(30000) });
    guard(job.transportEvidence === 'github-live-current-final-job' && job.runFinished && job.successful);
    signal.throwIfAborted(); await recheckLocalCheckoutRelease(release);
    guard(finalizationSnapshot);
    const refreshedAt = Date.now();
    original('decline-final-readback.intent.json', { maximumObservations: 1, readOnly: true, paymentAccepted: false, retryAllowed: false });
    const refreshed = await observeCurrentProviderDecline({ operationId: c.operationId, sessionId: input.proof.checkout.sessionId,
     customerAccountId: input.proof.customerAccountId, origin: c.origin }, {
     checkout: id => stripe.checkout.sessions.retrieve(id), invoice: id => stripe.invoices.retrieve(id),
     invoicePayments: id => stripe.invoicePayments.list({ invoice: id, limit: 10 }), paymentIntent: id => stripe.paymentIntents.retrieve(id),
    }, AbortSignal.timeout(30000));
    guard(refreshed.providerDeclineObserved && refreshed.invoiceId === finalizationSnapshot.invoiceId && refreshed.paymentIntentId === finalizationSnapshot.paymentIntentId);
    const identityReads = stripeCheckoutReads(stripe), platform = await identityReads.platform(), balance = await identityReads.balance(),
     customer = await identityReads.customer(input.proof.customerAccountId), clock = await identityReads.clock(prerequisites.target.clockId);
    guard(platform.id === process.env.STRIPE_PLATFORM_ACCOUNT_ID && balance.livemode === false && customer.id === input.proof.customerAccountId &&
     customer.livemode === false && customer.configuration?.customer?.test_clock === prerequisites.target.clockId &&
     clock.id === prerequisites.target.clockId && clock.name === `givetogive:${c.runId}` && clock.livemode === false &&
     clock.status === 'ready' && clock.frozen_time === prerequisites.target.frozenTime);
    const database = await inspectCurrentDeclineApp({ sessionId: input.proof.checkout.sessionId, customerAccountId: input.proof.customerAccountId,
     invoiceId: refreshed.invoiceId, paymentIntentId: refreshed.paymentIntentId });
    const app = verifyCurrentDeclineAppSnapshot({ ...finalizationSnapshot, database });
    const events = await observeCurrentFailureEvents({ platformAccountId: process.env.STRIPE_PLATFORM_ACCOUNT_ID,
     customerAccountId: input.proof.customerAccountId, invoiceId: refreshed.invoiceId, paymentIntentId: refreshed.paymentIntentId }, database.failureEvents,
     id => stripe.events.retrieve(id), AbortSignal.timeout(30000));
    guard(events.processedFailureEventCorrelated && !events.webhookProcessingPending && !app.webhookProcessingPending);
    const budget = inspectPreparedCheckoutCandidateBudget(run, c.planDigest, credentials, c.operationId,
     { headSha: head, financialState: 'submitted', noticeConsumed: finalizationSnapshot.noticeConsumed });
    await recheckLocalCheckoutRelease(release);
    guard(Date.now() - refreshedAt <= 30000); signal.throwIfAborted();
    original('decline-final-readback.result.json', { provider: refreshed, app, events, budget, paymentAccepted: false, retryAllowed: false });
    const prior = ledger.get(c.operationId);
    guard(prior?.state === 'submitted' && prior.actorId === c.memberId && prior.amountCents === 500 && prior.scenario === 'decline');
    original('decline-finalization.intent.json', { operationId: c.operationId, actorId: c.memberId, headSha: head,
     maximumTransitions: 1, from: 'submitted', to: 'verified_decline', originalBudgetHoldsPreserved: true, paymentAccepted: false, retryAllowed: false });
    ledger.finalizeSubmittedDecline(c.operationId, c.memberId, 500);
    guard(ledger.get(c.operationId)?.state === 'verified_decline');
    original('decline-finalization.result.json', { operationId: c.operationId, originalDeclineVerified: true,
     originalBudgetHoldsPreserved: true, paymentAccepted: false, retryAllowed: false });
    declineVerified = true;
   }
  } catch { failure = true; }
  try { ledger?.close(); } catch { failure = true; }
  key?.fill(0); token = undefined; input = undefined; finalizationSnapshot = undefined;
  process.off('SIGINT', stop); process.off('SIGTERM', stop);
 }
 guard(!failure);
 return { nativeOperatorFinished: true, privateFinalRetained: true, originalDeclineVerified: declineVerified,
  independentClosureAndSettlementRequired: !declineVerified, originalBudgetHoldsPreserved: true, paymentAccepted: false, retryAllowed: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 try {
  if (process.argv.length === 3 && process.argv[2] === '--execute-reviewed-current') console.log(JSON.stringify(await executeCurrentNativeOperator()));
  else if(process.argv.length===3&&process.argv[2]==='--execute-reviewed-predispatch-recovery')console.log(JSON.stringify(await executeCurrentNativeOperator('predispatch')));
  else if(process.argv.length===3&&process.argv[2]==='--execute-reviewed-readiness-recovery')console.log(JSON.stringify(await executeCurrentNativeOperator('readiness')));
  else { guard(process.argv.length === 2); console.log(JSON.stringify({ execute: false, externalRequests: 0, checkoutCreated: false, paymentAccepted: false })); }
 } catch { console.error('Current native operator stopped; originals and holds retained; no retry; private details withheld.'); process.exitCode = 1; }
}
