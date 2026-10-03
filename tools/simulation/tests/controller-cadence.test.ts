import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerPollingDelay } from '../src/controller-cadence.ts';

test('controller publication cadence includes successful request work', () => {
	assert.equal(controllerPollingDelay(1000, 1200, false), 800);
	assert.equal(controllerPollingDelay(1000, 1750, false), 250);
});

test('slow requests yield and failures preserve two-second backoff', () => {
	assert.equal(controllerPollingDelay(1000, 6000, false), 250);
	assert.equal(controllerPollingDelay(1000, 6000, true), 2000);
	assert.equal(controllerPollingDelay(1000, 1200, true), 2000);
});

test('wall-clock rollback cannot cause a hot loop', () => {
	assert.equal(controllerPollingDelay(1000, 900, false), 1000);
});
