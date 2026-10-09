// Injected GitHub only; no real private draft, dispatch or payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitCurrentDraftAssociation, currentPendingDraftBody } from '../src/checkout-current-association.ts';
import { CurrentCheckoutPrivateDraft } from '../src/checkout-current-draft.ts';
import { currentProfile, head, source, now } from './fixtures/current-checkout.ts';
function fixture(mode = 'pending') {
 const draft = new CurrentCheckoutPrivateDraft(currentProfile(), head, source, 42, 'public-fixture-token-only', { now: () => now });
 let authenticated = 0, anonymous = 0, verified = 0;
 const release: { id: number; draft: boolean; prerelease: boolean; published_at: null; target_commitish: string;
  tag_name: string; body: string; assets: unknown[] } = { id: 42, draft: true, prerelease: false, published_at: null,
  target_commitish: head, tag_name: `checkout-current-${draft.association.operationId}`,
  body: JSON.stringify(currentPendingDraftBody(draft)), assets: [] };
 const request: typeof fetch = async (url, init) => {
  assert.equal(String(url), 'https://api.github.com/repos/irackson/givetogive/releases/42'); assert.equal(init?.method, 'GET');
  const authenticatedRequest = new Headers(init?.headers).has('Authorization');
  if (!authenticatedRequest) { anonymous++; return new Response(null, { status: mode === 'public' ? 200 : 404 }); }
  authenticated++; assert.equal(init?.redirect, 'error');
  if (mode === 'exact' || mode === 'pending' && authenticated > 1) release.body = JSON.stringify(draft.association);
  return new Response(JSON.stringify(release));
 };
 const options = { token: 'public-fixture-token-only', signal: new AbortController().signal, request, pollMs: 1, timeoutMs: 1000,
  verifyCurrent: async () => { verified++; if (mode === 'context') throw Error('offline changed context'); } };
 return { draft, release, options, counts: () => ({ authenticated, anonymous, verified }) };
}
test('empty pending draft waits for exact root association with only GET requests', async () => {
 const f = fixture(); const result = await awaitCurrentDraftAssociation(f.draft, 42, f.options);
 assert.equal(result.exactCurrentAssociationObserved, true); assert.equal(result.paymentAccepted, false);
 assert.equal(result.transportEvidence, 'injected-offline-http'); assert.equal(f.counts().authenticated, 2);
});
test('already-associated draft proceeds without a write', async () => {
 const f = fixture('exact'); await awaitCurrentDraftAssociation(f.draft, 42, f.options); assert.equal(f.counts().authenticated, 1);
});
test('foreign, prematurely populated, wrong-head and published drafts reject immediately', async () => {
 for (const mode of ['foreign', 'asset', 'head', 'published', 'public', 'context']) {
  const f = fixture(mode);
  if (mode === 'foreign') f.release.body = JSON.stringify({ ...currentPendingDraftBody(f.draft), operationId: 'foreign-operation' });
  if (mode === 'asset') f.release.assets.push({ name: 'foreign-asset' });
  if (mode === 'head') f.release.target_commitish = 'f'.repeat(40);
  if (mode === 'published') f.release.draft = false;
  await assert.rejects(() => awaitCurrentDraftAssociation(f.draft, 42, f.options)); assert.ok(f.counts().authenticated <= 1);
 }
});
test('wrong associated job nonce is not another pending state', async () => {
 const f = fixture('wrong-nonce'); f.release.body = JSON.stringify({ ...f.draft.association, jobNonce: 'f'.repeat(32) });
 await assert.rejects(() => awaitCurrentDraftAssociation(f.draft, 42, f.options)); assert.equal(f.counts().authenticated, 1);
});
test('pending association has bounded wait and supports cancellation', async () => {
 const f = fixture('never-associated'); f.options.timeoutMs = 20;
 await assert.rejects(() => awaitCurrentDraftAssociation(f.draft, 42, f.options));
 const g = fixture(); const controller = new AbortController(); controller.abort(); g.options.signal = controller.signal;
 await assert.rejects(() => awaitCurrentDraftAssociation(g.draft, 42, g.options)); assert.equal(g.counts().authenticated, 0);
});
