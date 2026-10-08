import assert from 'node:assert/strict';
import test from 'node:test';
import type { Browser } from 'playwright';
import { CommunityBrowser } from '../src/community-browser.ts';
import { ActivitySelectionChanged, parseActivity } from '../src/activity.ts';
import { BrowserWorkflowFailure, browserDiagnostic } from '../src/browser-observation.ts';
import type { UiSession } from '../src/ui-session.ts';

// Injected driver tests exercise the actual lifecycle branch; not real Chromium evidence.
function fixture(mode: 'already-cancelled' | 'cancel-during-open' | 'complete-after-open' | 'broken-control') {
	let reads=0, opens=0, confirms=0, intents=0, closed=0;
	let status=mode==='already-cancelled' ? 'cancelled' : 'pledged';
	const control={click:async()=>{
		opens++;
		if(mode==='cancel-during-open')status='cancelled';
		if(mode==='cancel-during-open'||mode==='broken-control')throw Error('Private selector fixture');
	}};
	const row={waitFor:async()=>{},getByRole:()=>control};
	const dialog={waitFor:async()=>{
		if(mode==='complete-after-open')status='completed';
	},getByRole:()=>({click:async()=>{confirms++;throw Error('Unexpected confirmation');}})};
	const page={on:()=>{},goto:async()=>{},locator:()=>row,getByRole:()=>dialog};
	const context={route:async()=>{},setExtraHTTPHeaders:async()=>{},
		request:{get:async()=>({json:async()=>({user:{id:'owner'}}),dispose:async()=>{}})},
		newPage:async()=>page,close:async()=>{closed++;}};
	const browser={newContext:async()=>context,close:async()=>{}} as unknown as Browser;
	const api={origin:'https://givetogive-staging.vercel.app',userId:'owner',
		context:{storageState:async()=>({cookies:[],origins:[]})},query:async()=>{
			reads++;
			return {id:8,type:'task',createdById:'owner',status:'in_progress',goalAmount:2,contributedAmount:1,
				contributions:[{id:31,contributorId:'helper',status}]};
		}} as unknown as UiSession;
	const [line]=parseActivity(JSON.stringify({id:'complete',user:'owner',action:'set_contribution_status',
		status:'completed',contribution:{ref:'pledge'}}));
	const runner=new CommunityBrowser(1,async()=>browser);
	return {run:()=>runner.action(api,line!,undefined,undefined,()=>{intents++;},
		{kind:'contribution',id:31,askId:8}),counts:()=>({reads,opens,confirms,intents,closed})};
}

test('actual lifecycle driver never opens an already-cancelled exact pledge',async()=>{
	const setup=fixture('already-cancelled');
	await assert.rejects(setup.run(),ActivitySelectionChanged);
	assert.deepEqual(setup.counts(),{reads:1,opens:0,confirms:0,intents:0,closed:1});
});
test('actual lifecycle driver observes cancellation during control opening without confirmation or replay',async()=>{
	const setup=fixture('cancel-during-open');
	await assert.rejects(setup.run(),ActivitySelectionChanged);
	assert.deepEqual(setup.counts(),{reads:2,opens:1,confirms:0,intents:0,closed:1});
});
test('actual lifecycle driver checks a newly completed pledge after opening its dialog',async()=>{
	const setup=fixture('complete-after-open');
	await assert.rejects(setup.run(),ActivitySelectionChanged);
	assert.deepEqual(setup.counts(),{reads:2,opens:1,confirms:0,intents:0,closed:1});
});
test('actual lifecycle driver still fails on a broken control for an eligible target',async()=>{
	const setup=fixture('broken-control');
	await assert.rejects(setup.run(),error=>{
		assert.ok(error instanceof BrowserWorkflowFailure);
		assert.equal(browserDiagnostic(error).browserPhase,'contribution_history');
		assert.equal(browserDiagnostic(error).browserMutationSent,false);
		assert.doesNotMatch(error.message,/Private selector/);
		return true;
	});
	assert.deepEqual(setup.counts(),{reads:2,opens:1,confirms:0,intents:0,closed:1});
});
