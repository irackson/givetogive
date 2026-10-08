import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ActivitySelectionChanged, freshContributionStatusTarget, executeActivity, parseActivity } from '../src/activity.ts';
import { BrowserWorkflowFailure, observeContributionStatusControl, type BrowserObservationState } from '../src/browser-observation.ts';
import type { UiApi } from '../src/ui-session.ts';
const state = (): BrowserObservationState => ({ phase:'contribution_history', mutationAdmitted:false, mutationSent:false, pageErrors:0, consoleErrors:0 });
const entity = {kind:'contribution' as const,id:31,askId:8};
const detail = () => ({id:8,type:'task',createdById:'owner',status:'in_progress',goalAmount:2,contributedAmount:1,
	contributions:[{id:31,contributorId:'helper',status:'pledged'}]});
const api = (userId:string, value:unknown): UiApi => ({userId,query:async()=>value,mutate:async()=>{throw Error('No write expected');}});
test('exact pledged lifecycle record allows only owner/contributor completion and contributor cancellation',async()=>{
	for(const user of ['owner','helper'])assert.equal((await freshContributionStatusTarget(api(user,detail()),entity,'completed')).id,31);
	assert.equal((await freshContributionStatusTarget(api('helper',detail()),entity,'cancelled')).id,31);
	for(const [user,status] of [['owner','cancelled'],['stranger','completed'],['stranger','cancelled']] as const)
		await assert.rejects(freshContributionStatusTarget(api(user,detail()),entity,status),ActivitySelectionChanged);
});
test('cancelled/completed/missing or payment-backed exact target invalidates without selecting another pledge',async()=>{
	for(const status of ['completed','cancelled']){
		const value=detail();value.contributions[0]!.status=status;
		await assert.rejects(freshContributionStatusTarget(api('owner',value),entity,'completed'),ActivitySelectionChanged);
	}
	for(const value of [{...detail(),contributions:[]},{...detail(),type:'money'},{...detail(),paymentEnabled:true},
		{...detail(),contributions:[{id:32,contributorId:'helper',status:'pledged'}]}])
		await assert.rejects(freshContributionStatusTarget(api('owner',value),entity,'completed'),ActivitySelectionChanged);
});
test('malformed API, foreign parent or transport error are failures, never waiting',async()=>{
	for(const value of [{wrong:true},{...detail(),id:9}])await assert.rejects(
		freshContributionStatusTarget(api('owner',value),entity,'completed'),e=>!(e instanceof ActivitySelectionChanged));
	const transport=Error('private transport fixture'),client=api('owner',detail());client.query=async()=>{throw transport;};
	await assert.rejects(freshContributionStatusTarget(client,entity,'completed'),e=>e===transport);
});
test('live cancellation while control is opening becomes authoritative pre-submit selection change',async()=>{
	const value=detail(),client=api('owner',value),observation=state();let clicks=0;
	await assert.rejects(observeContributionStatusControl(observation,
		()=>freshContributionStatusTarget(client,entity,'completed'),async()=>{
			clicks++;value.contributions[0]!.status='cancelled';throw Error('Control disappeared');
		}),ActivitySelectionChanged);
	assert.equal(clicks,1);assert.equal(observation.mutationAdmitted,false);assert.equal(observation.mutationSent,false);
});
test('successful dialog opening still rechecks target before the confirmation mutation',async()=>{
	const value=detail(),client=api('owner',value);let opens=0;
	await assert.rejects(observeContributionStatusControl(state(),()=>freshContributionStatusTarget(client,entity,'completed'),
		async()=>{opens++;value.contributions[0]!.status='completed';}),ActivitySelectionChanged);
	assert.equal(opens,1);
});
test('eligible target with broken UI preserves original error with no retries or invented wait',async()=>{
	const failure=Error('private selector fixture');let reads=0,opens=0;
	await assert.rejects(observeContributionStatusControl(state(),async()=>{reads++;},async()=>{opens++;throw failure;}),e=>e===failure);
	assert.equal(reads,2);assert.equal(opens,1);
});
test('changed target before opening never clicks',async()=>{
	let opens=0;
	await assert.rejects(observeContributionStatusControl(state(),async()=>{throw new ActivitySelectionChanged();},async()=>{opens++;}),ActivitySelectionChanged);
	assert.equal(opens,0);
});
test('post-admission, console/page errors and wrong phase cannot mask a failure as a changed target',async()=>{
	for(const override of [{mutationAdmitted:true},{mutationSent:true},{consoleErrors:1},{pageErrors:1},{phase:'mutation_response' as const}]){
		let reads=0,opens=0;
		await assert.rejects(observeContributionStatusControl({...state(),...override},async()=>{reads++;},async()=>{opens++;}),BrowserWorkflowFailure);
		assert.equal(reads,0);assert.equal(opens,0);
	}
	const observation=state();let reads=0;
	await assert.rejects(observeContributionStatusControl(observation,async()=>{reads++;},async()=>{
		observation.mutationSent=true;throw Error('uncertain');
	}),BrowserWorkflowFailure);assert.equal(reads,1);
});
test('controller admission failures remain exact and no subsequent target query occurs',async()=>{
	let reads=0;const failure=Error('stop admission');
	await assert.rejects(observeContributionStatusControl(state(),async()=>{reads++;},async()=>{},()=>{throw failure;}),e=>e===failure);
	assert.equal(reads,0);
});
test('browser lifecycle race waits only before intent, never counts success or sends API fallback',async()=>{
	const [line]=parseActivity(JSON.stringify({id:'complete',user:'owner',action:'set_contribution_status',status:'completed',contribution:{ref:'pledge'}}));
	let admissions=0;const hooks={beforeMutation(){admissions++;},browserAction:async()=>{throw new ActivitySelectionChanged();}};
	const refs=new Map([['pledge',entity]]);
	assert.deepEqual(await executeActivity(api('owner',detail()),line!,refs,hooks),{outcome:'waiting'});
	assert.equal(admissions,0);
	await assert.rejects(executeActivity(api('owner',detail()),line!,refs,{...hooks,browserAction:async(__line,__ask,admit)=>{
		admit!('ask.updateContributionStatus');throw new ActivitySelectionChanged();
	}}),ActivitySelectionChanged);assert.equal(admissions,1);
});
test('actual browser lifecycle branch wires exact target observation before native dialog confirmation',()=>{
	const source=readFileSync(new URL('../src/community-browser.ts',import.meta.url),'utf8');
	const branch=source.slice(source.indexOf("if (line.action === 'set_contribution_status')"),source.indexOf('if (!ask)'));
	assert.ok(branch.includes('observeContributionStatusControl(observation,'));
	assert.ok(branch.includes('freshContributionStatusTarget(api, entity, line.status)'));
	assert.ok(branch.indexOf('observeContributionStatusControl')<branch.indexOf('await confirmMutation'));
	assert.ok(!branch.includes('api.mutate('));
});
