import { freemem, totalmem } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { LocalBrain, deterministicDecision, localModelKey } from './brain.ts';
import { BrowserPool } from './browser.ts';
import type { Options } from './config.ts';
import { makePersonas } from './personas.ts';
import { readTools, type AgentCheckpoint, type AgentCredentials, type AgentState, type ControlCommand, type Credentials, type Persona } from './protocol.ts';
import { checkoutBudget, redact, validatedArguments } from './safety.ts';
import { protectionSecret } from './protection.ts';
import { Semaphore } from './semaphore.ts';
import { Store } from './store.ts';
import { HostedTransport, MemberClient, type RemoteTool } from './transport.ts';
import { flushOutbox } from './outbox.ts';

type Individual = { persona: Persona; credentials: AgentCredentials; state: AgentCheckpoint; brain: LocalBrain; client: MemberClient; tools?: RemoteTool[] };

export class SimulationRunner {
  readonly store: Store;
  readonly inference: Semaphore;
  readonly browsers: BrowserPool;
  private readonly connections = new Semaphore(2);
  private readonly hosted: HostedTransport;
  private readonly people: Individual[];
  private readonly options: Options;
  private readonly secrets: string[];
  private stopping = false;
  private stopReason: 'interrupted' | 'stopped' | 'completed' = 'interrupted';
  private paused = false;
  private paymentsConfigured = false;
  private rate = 1;
  private lastGpu: Record<string, unknown> = {};
  private lastGpuAt = 0;
  private readonly cancellation = new AbortController();

  constructor(options: Options, credentials: Credentials) {
    const bypass = protectionSecret();
    this.options = options;
    this.store = new Store(join(options.stateDirectory, 'simulation.sqlite'), options.runId);
    this.inference = new Semaphore(options.inferenceConcurrency);
    this.browsers = new BrowserPool(credentials.origin, options.stateDirectory, options.browserConcurrency, bypass);
    this.hosted = new HostedTransport(credentials, bypass);
    this.secrets = [credentials.runnerToken, bypass ?? '', localModelKey(), ...credentials.agents.flatMap((agent) => [agent.token, agent.password ?? ''])];
    this.paused = this.store.meta('paused') === 'true';
    this.rate = Number(this.store.meta('rate') ?? 1);
    const accounts = credentials.agents.slice(0, options.population);
    this.people = makePersonas(accounts, options.seed).map((persona, i) => {
      const account = accounts[i]!;
      const state = this.store.load(persona.id) ?? { id: persona.id, state: 'idle', cycles: 0, actions: 0, failures: 0, nextWakeAt: Date.now() + i * 100, memories: [], observation: '', paused: false, spentCents: 0 };
      return { persona, credentials: account, state, brain: new LocalBrain(persona, options.modelUrl, options.model), client: new MemberClient(credentials.origin, account, bypass) };
    });
  }

  async preflight() {
    if (['stopped', 'completed'].includes(this.store.meta('lifecycle') ?? '')) throw new Error('This local run is terminal. Use npm run sync for any pending telemetry, and create a new run for another experiment.');
    const manifest = await this.hosted.manifest();
    if (['stopped', 'completed', 'cancelled'].includes(manifest.runStatus ?? '')) throw new Error('This hosted run is terminal. Provision a new run for another experiment.');
    this.paymentsConfigured = manifest.paymentsConfigured;
    if (freemem() / 2 ** 30 < this.options.minimumFreeGiB) throw new Error('Insufficient free RAM. The runner will not close applications for you.');
    if (this.options.mode === 'autonomous') {
      const response = await fetch(new URL('/health', this.options.modelUrl), { headers: { Authorization: `Bearer ${localModelKey()}` }, signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) throw new Error('Local model server is not healthy.');
    }
    const identity = `${this.options.population}:${this.options.seed}:${this.options.mode}`;
    const existing = this.store.meta('identity');
    if (existing && existing !== identity) throw new Error('Run ID belongs to different population/seed/mode. Use a new run ID.');
    this.store.meta('identity', identity);
    return { runId: this.options.runId, mode: this.options.mode, population: this.people.length, freeRamGiB: freemem() / 2 ** 30 };
  }

  private transition(person: Individual, state: AgentState, summary: string, data: Record<string, unknown> = {}, correlationId?: string) {
    person.state.state = state;
    this.store.checkpoint(person.state);
    this.store.event(person.persona.id, state, 'agent_state', redact(summary, this.secrets), data, correlationId);
  }

  command(command: ControlCommand) {
    if (this.store.hasCommand(command.id)) return;
    switch (command.type) {
      case 'pause': this.paused = true; this.store.meta('paused', 'true'); break;
      case 'resume': this.paused = false; this.store.meta('paused', 'false'); break;
      case 'stop': this.stop('stopped'); break;
      case 'set_concurrency':
        if (!Number.isInteger(command.value) || command.value! < 1 || command.value! > 2) throw new Error('Runtime inference concurrency must be one or two.');
        this.inference.resize(command.value!); break;
      case 'set_rate': {
        if (!command.value || command.value < .1 || command.value > 5) throw new Error('Activity rate must be 0.1-5.');
        this.rate = command.value; this.store.meta('rate', String(this.rate)); break;
      }
      case 'pause_agent':
      case 'resume_agent': {
        const person = this.people.find((candidate) => candidate.persona.id === command.agentId);
        if (!person) throw new Error('Unknown simulation member.');
        person.state.paused = command.type === 'pause_agent';
        this.store.checkpoint(person.state); break;
      }
    }
    this.store.acknowledgeCommand(command.id);
    this.store.event('runner', 'idle', 'control_applied', `Applied ${command.type}`, { commandId: command.id });
  }

  stop(reason: 'interrupted' | 'stopped' | 'completed' = 'interrupted') {
    if (this.stopping) return;
    this.stopReason = reason; this.stopping = true; this.cancellation.abort();
  }

  private async reconcile(person: Individual) {
    const pending = person.state.pendingAction;
    if (!pending) return true;
    if (!person.tools?.some(({ name }) => name === 'get_operation_status')) return false;
    const raw = await person.client.call('get_operation_status', { correlationId: pending.correlationId }, pending.correlationId);
    let result = raw as { status?: string; result?: unknown };
    if (Array.isArray(raw)) {
      const first = raw.find((block: { type?: string }) => block.type === 'text') as { text?: string } | undefined;
      if (first?.text) result = JSON.parse(first.text) as typeof result;
    }
    if (result.status === 'completed' || result.status === 'succeeded') {
      person.state.observation = redact(result.result ?? result, this.secrets).slice(0, 4500);
      if (pending.tool === 'prepare_checkout') person.state.spentCents += checkoutBudget(JSON.parse(pending.argumentsJson) as Record<string, unknown>);
      person.state.actions++;
      delete person.state.pendingAction;
      this.store.checkpoint(person.state);
      return true;
    }
    if (result.status === 'failed') {
      person.state.observation = 'The previous action definitively failed. Choose a new action.';
      delete person.state.pendingAction;
      this.store.checkpoint(person.state);
      return true;
    }
    return false; // Not-found is not proof the prior request cannot still arrive.
  }

  private async cycle(person: Individual) {
    if (freemem() / 2 ** 30 < this.options.minimumFreeGiB) {
      person.state.nextWakeAt = Date.now() + 5000;
      this.transition(person, 'backing_off', 'Resource admission paused: waiting for RAM headroom.');
      return;
    }
    const correlationId = randomUUID();
    if (!person.tools) {
      this.transition(person, 'observing', 'Connecting this member to their scoped MCP session.');
      person.tools = (await this.connections.run(() => person.client.connect())).filter(tool => this.paymentsConfigured || tool.name !== 'prepare_checkout');
    }
    if (!await this.reconcile(person)) {
      person.state.paused = true;
      this.transition(person, 'paused', 'A prior mutation has an ambiguous outcome; reconciliation is required before another mutation.', {}, person.state.pendingAction?.correlationId);
      return;
    }
    if (!person.state.observation) {
      this.transition(person, 'observing', 'Reading public Asks through this account.');
      person.state.observation = redact(await person.client.call('search_asks', {}, correlationId), this.secrets).slice(0, 4500);
    }
    const queuedAt = Date.now();
    this.transition(person, 'waiting_for_inference', 'Waiting for a shared local model slot.');
    const decision = await this.inference.run(async () => {
      if (this.stopping || this.paused || person.state.paused) return undefined;
      if (freemem() / 2 ** 30 < this.options.minimumFreeGiB) {
        person.state.nextWakeAt = Date.now() + 5000;
        this.transition(person, 'backing_off', 'Resource admission paused: waiting for RAM headroom.');
        return undefined;
      }
      this.transition(person, 'generating', 'Choosing this member’s next action.', { queueLatencyMs: Date.now() - queuedAt });
      return this.options.mode === 'deterministic' ? deterministicDecision(person.state) : person.brain.decide(person.state, person.tools!, AbortSignal.any([this.cancellation.signal, AbortSignal.timeout(60000)]));
    });
    if (!decision) return;
    const args = validatedArguments(decision, person.persona, person.state);
    if (decision.tool !== 'browse_page' && decision.tool !== 'wait' && !person.tools.some(({ name }) => name === decision.tool)) throw new Error('Model selected an unavailable tool.');
    // Pause/stop admission is checked again after inference, before any application mutation.
    if (this.stopping || this.paused || person.state.paused) return;
    this.transition(person, 'acting', decision.summary, { tool: decision.tool }, correlationId);
    const began = Date.now();
    let result: unknown;
    const mutation = !readTools.has(decision.tool) && !['browse_page', 'wait'].includes(decision.tool);
    if (mutation) {
      person.state.pendingAction = { correlationId, tool: decision.tool, argumentsJson: decision.argumentsJson };
      this.store.checkpoint(person.state);
    }
    if (decision.tool === 'wait') result = { waited: true };
    else if (decision.tool === 'browse_page') result = await this.browsers.browse(person.credentials, String(args.path ?? '/asks'), correlationId);
    else result = await person.client.call(decision.tool, args, correlationId);
    delete person.state.pendingAction;
    if (decision.tool !== 'wait') person.state.actions++;
    if (decision.tool === 'prepare_checkout') person.state.spentCents += checkoutBudget(args);
    person.state.cycles++;
    person.state.failures = 0;
    person.state.observation = redact(result, this.secrets).slice(0, 4500);
    person.state.memories = [...person.state.memories, redact(decision.memory, this.secrets), `Cycle ${person.state.cycles}: ${decision.tool} succeeded.`].filter(Boolean).slice(-8);
    person.state.nextWakeAt = Date.now() + decision.wakeAfterSeconds * 1000 / this.rate;
    this.store.event(person.persona.id, 'idle', 'action_result', `${decision.tool} completed`, { tool: decision.tool, actionLatencyMs: Date.now() - began, cycles: person.state.cycles, actions: person.state.actions, outcome: 'success' }, correlationId);
    this.transition(person, 'idle', 'Waiting for the next personal activity time.');
  }

  private async memberLoop(person: Individual) {
    while (!this.stopping) {
      if (this.options.maxCyclesPerAgent && person.state.cycles >= this.options.maxCyclesPerAgent) {
        if (this.people.every(member => member.state.cycles >= this.options.maxCyclesPerAgent)) this.stop('completed');
        else await sleep(500);
        continue;
      }
      if (this.paused || person.state.paused) {
        if (person.state.state !== 'paused') this.transition(person, 'paused', 'This member is paused.');
        await sleep(500); continue;
      }
      if (Date.now() < person.state.nextWakeAt) { await sleep(Math.min(500, person.state.nextWakeAt - Date.now())); continue; }
      try { await this.cycle(person); }
      catch (error) {
        if (this.stopping) break;
        person.state.failures++;
        person.state.nextWakeAt = Date.now() + Math.min(120000, 2000 * 2 ** Math.min(person.state.failures, 6));
        if (person.state.failures >= 5 || person.state.pendingAction) person.state.paused = true;
        this.transition(person, person.state.paused ? 'failed' : 'backing_off', redact(error instanceof Error ? error.message : String(error), this.secrets), { failures: person.state.failures });
      }
    }
    this.transition(person, 'paused', 'Runner stopped; member checkpoint saved.');
    await person.client.close().catch(() => undefined);
  }

  private metrics() {
    if (Date.now() - this.lastGpuAt > 20000) {
      this.lastGpuAt = Date.now();
      try {
        const [used, total, utilization] = execFileSync('nvidia-smi', ['--query-gpu=memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim().split(',').map(Number);
        this.lastGpu = { gpuUsedMiB: used, gpuTotalMiB: total, gpuUtilizationPercent: utilization };
      } catch { this.lastGpu = { gpuMetricsAvailable: false }; }
    }
    return { population: this.people.length, mode: this.options.mode, model: this.options.model, ramFreeGiB: freemem() / 2 ** 30, ramTotalGiB: totalmem() / 2 ** 30,
      inferenceActive: this.inference.active, inferenceQueued: this.inference.waiting, inferenceConcurrency: this.inference.limit,
      browserActive: this.browsers.slots.active, browserQueued: this.browsers.slots.waiting,
      cycles: this.people.reduce((sum, { state }) => sum + state.cycles, 0), actions: this.people.reduce((sum, { state }) => sum + state.actions, 0), ...this.lastGpu };
  }

  private async pump() {
    while (!this.stopping) {
      try {
        const control = await this.hosted.control(this.options.runId, this.store.meta('controlCursor') ?? '');
        for (const command of control.commands) {
          try { this.command(command); } catch (error) { this.store.event('runner', 'failed', 'control_rejected', String(error), { commandId: command.id }); }
        }
        this.store.meta('controlCursor', control.cursor);
        this.store.event('runner', this.paused ? 'paused' : 'idle', 'heartbeat', 'Local simulation runner is connected.', this.metrics());
        this.store.acknowledge(await this.hosted.events(this.options.runId, this.store.pendingEvents()));
      } catch (error) {
        // Durable outbox retains events; transport errors never turn into fabricated hosted successes.
        console.error(`Control/telemetry offline: ${redact(error instanceof Error ? error.message : String(error), this.secrets)}`);
      }
      await sleep(2000);
    }
  }

  async run() {
    console.log(JSON.stringify(await this.preflight()));
    this.store.event('runner', 'idle', 'run_started', 'Simulation started with isolated, independently scheduled members.', { population: this.people.length, model: this.options.model, mode: this.options.mode });
    // Replay durable telemetry, including this start, before admitting member calls.
    // A paused or stale-running run can resume; terminal runs fail preflight.
    await flushOutbox(this.store, events => this.hosted.events(this.options.runId, events));
    const timer = setTimeout(() => this.stop('completed'), this.options.durationSeconds * 1000);
    try { await Promise.all([this.pump(), ...this.people.map((person) => this.memberLoop(person))]); }
    finally {
      clearTimeout(timer); this.stop();
      await this.browsers.close();
      this.store.meta('lifecycle', this.stopReason);
      const eventKind = this.stopReason === 'completed' ? 'run_completed' : this.stopReason === 'stopped' ? 'run_stopped' : 'run_paused';
      this.store.event('runner', 'paused', eventKind, this.stopReason === 'interrupted' ? 'Runner interrupted; checkpoints saved for resume.' : 'Run finished; checkpoints retained.', this.metrics());
      try { await flushOutbox(this.store, events => this.hosted.events(this.options.runId, events)); }
      catch { console.error('Telemetry remains in the local outbox; use npm run sync to deliver it without restarting actors.'); }
      console.log(JSON.stringify(this.store.report(), null, 2));
      this.store.close();
    }
  }
}
