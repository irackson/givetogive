'use client';

import { api } from '@/trpc/react';
import {
	Alert,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	MenuItem,
	TextField,
} from '@mui/material';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AdminActivity } from './AdminActivity';
import {
	Freshness,
	NumericMetric,
	QueryError,
	ResourceBar,
} from './AdminPrimitives';
import {
	DateLabel,
	EmptyState,
	MetricCard,
	Panel,
	PaymentLoading,
	StatusPill,
} from './PaymentPrimitives';

export function AdminSimulations() {
	const runs = api.admin.simulations.useQuery(undefined, {
		refetchInterval: 2000,
		refetchIntervalInBackground: false,
	});
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const [mode, setMode] = useState<'autonomous' | 'deterministic'>(
		'autonomous',
	);
	const [count, setCount] = useState(100);
	const router = useRouter();
	const create = api.admin.createSimulation.useMutation({
		onSuccess: (run) => router.push(`/admin/simulations/${run.id}`),
	});
	return (
		<>
			<div className='admin-toolbar'>
				<h2 className='section-title'>A neighborhood in rehearsal.</h2>
				<Button
					variant='contained'
					disabled={!runs.data?.enabled}
					onClick={() => setOpen(true)}>
					Create simulation run
				</Button>
			</div>
			<p className='payment-note'>
				Independent synthetic members, shared local inference. A hundred
				active agents does not mean a hundred simultaneous model
				generations. Payment actions are test-only; the local runner
				must be connected to act.
			</p>
			{runs.error && (
				<QueryError
					message='Simulation runs could not refresh.'
					retry={() => void runs.refetch()}
				/>
			)}
			{runs.isPending ?
				<PaymentLoading />
			:	runs.data && (
					<>
						{!runs.data.enabled && (
							<Alert severity='info'>
								Simulation controls are disabled outside
								explicitly enabled staging.
							</Alert>
						)}
						<Panel
							title='Runs & recorded history'
							action={
								<Freshness
									updatedAt={runs.dataUpdatedAt}
									error={runs.isError}
									fetching={runs.isFetching}
								/>
							}>
							{runs.data.items.length ?
								<div className='payment-table-wrap'>
									<table className='payment-table'>
										<thead>
											<tr>
												<th scope='col'>Run</th>
												<th scope='col'>Mode</th>
												<th scope='col'>Members</th>
												<th scope='col'>State</th>
												<th scope='col'>Created</th>
											</tr>
										</thead>
										<tbody>
											{runs.data.items.map((run) => (
												<tr key={run.id}>
													<td>
														<Link
															href={`/admin/simulations/${run.id}`}>
															{run.name}
														</Link>
														<small>{run.id}</small>
													</td>
													<td>
														{(
															run.mode ===
															'deterministic'
														) ?
															'Deterministic scenarios'
														:	'Autonomous community'}
													</td>
													<td>{run.agentCount}</td>
													<td>
														<StatusPill
															status={run.status}
														/>
													</td>
													<td>
														<DateLabel
															value={
																run.createdAt
															}
														/>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							:	<EmptyState title='No simulation runs yet.'>
									Create a run in staging, then connect the
									local runner using the documented simulation
									command. Creating a record does not launch a
									background process.
								</EmptyState>
							}
						</Panel>
					</>
				)
			}
			<Dialog
				open={open}
				onClose={() => {
					if (!create.isPending) setOpen(false);
				}}
				maxWidth='sm'
				fullWidth
				aria-labelledby='create-run-title'>
				<DialogTitle id='create-run-title'>
					Create a test neighborhood.
				</DialogTitle>
				<DialogContent>
					<div className='payment-form'>
						<TextField
							label='Run name'
							value={name}
							onChange={(event) => setName(event.target.value)}
							inputProps={{ maxLength: 160 }}
						/>
						<TextField
							select
							label='Simulation mode'
							value={mode}
							onChange={(event) =>
								setMode(
									event.target.value as
										'autonomous' | 'deterministic',
								)
							}>
							<MenuItem value='autonomous'>
								Autonomous community · model-selected actions
							</MenuItem>
							<MenuItem value='deterministic'>
								Deterministic scenarios · repeatable regression
							</MenuItem>
						</TextField>
						<TextField
							select
							label='Individual agents'
							value={count}
							onChange={(event) =>
								setCount(Number(event.target.value))
							}>
							{[10, 25, 100].map((value) => (
								<MenuItem
									key={value}
									value={value}>
									{value}
								</MenuItem>
							))}
						</TextField>
						<p className='payment-muted'>
							Start with 10 agents, then 25 and 100 after checking
							latency and resource headroom. No cloud model
							fallback is used. New runs keep separate checkpoints
							and histories.
						</p>
						{create.error && (
							<Alert severity='error'>
								{create.error.message}
							</Alert>
						)}
					</div>
				</DialogContent>
				<DialogActions>
					<Button
						disabled={create.isPending}
						onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant='contained'
						disabled={create.isPending || name.trim().length < 3}
						onClick={() =>
							create.mutate({ name, mode, agentCount: count })
						}>
						{create.isPending ?
							'Creating run…'
						:	'Create run record'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}

export function AdminSimulation({
	id,
	agentId,
}: {
	id: string;
	agentId?: string;
}) {
	const query = api.admin.simulation.useQuery(
		{ id },
		{ refetchInterval: 2000, refetchIntervalInBackground: false },
	);
	const [tier, setTier] = useState('');
	const [state, setState] = useState('');
	const [concurrency, setConcurrency] = useState(1);
	const [rate, setRate] = useState(1);
	const [stopOpen, setStopOpen] = useState(false);
	const control = api.admin.controlSimulation.useMutation({
		onSuccess: () => setStopOpen(false),
	});
	if (query.isPending)
		return <PaymentLoading label='Loading simulation state' />;
	if (query.error)
		return (
			<QueryError
				message={query.error.message}
				retry={() => void query.refetch()}
			/>
		);
	const { run, agents, online } = query.data;
	const metrics = run.metrics;
	const selected =
		agentId ? agents.find((agent) => agent.id === agentId) : undefined;
	const filtered = agents.filter(
		(agent) =>
			(!tier || agent.tier === tier) && (!state || agent.state === state),
	);
	const states = [...new Set(agents.map((agent) => agent.state))].sort();
	const stateCounts = states.map((value) => ({
		state: value,
		count: agents.filter((agent) => agent.state === value).length,
	}));
	const totalRam = metrics['ramTotalGiB'];
	const freeRam = metrics['ramFreeGiB'];
	const usedRam =
		typeof totalRam === 'number' && typeof freeRam === 'number' ?
			totalRam - freeRam
		:	undefined;
	const commandPending = control.isPending;
	const terminal = ['stopped', 'completed'].includes(run.status);
	const controlsUnavailable =
		commandPending ||
		terminal ||
		run.environment !== 'staging' ||
		agents.length === 0;
	const safeRunId = /^[a-zA-Z0-9_-]{1,64}$/.test(run.id);
	return (
		<>
			<Link
				className='text-link'
				href={
					agentId ? `/admin/simulations/${id}` : '/admin/simulations'
				}>
				← {agentId ? 'Full simulation run' : 'All simulation runs'}
			</Link>
			<div className='admin-toolbar'>
				<div>
					<h2 className='section-title'>
						{selected?.name ?? run.name}
					</h2>
					<p className='payment-muted'>
						{run.mode === 'deterministic' ?
							'Deterministic scenario run'
						:	'Autonomous community'}{' '}
						· {run.agentCount} individual agents · {run.environment}
					</p>
				</div>
				<div className='payment-actions'>
					<StatusPill status={run.status} />
					<StatusPill status={online ? 'connected' : 'offline'} />
					<Freshness
						updatedAt={query.dataUpdatedAt}
						error={query.isError}
						fetching={query.isFetching}
					/>
				</div>
			</div>
			{!online && !terminal && agents.length > 0 && (
				<Alert severity='warning'>
					The local runner is offline or its heartbeat is stale. The
					hosted site is still available, but agents cannot act until
					the runner reconnects. Controls can be queued; they are not
					applied yet.
				</Alert>
			)}
			{terminal && (
				<Alert severity='info'>
					This run is finished. Its history remains available, but its
					controls cannot restart or change it. Create and provision a
					new run for another rehearsal.
				</Alert>
			)}
			{!agentId && run.status === 'created' && (
				<Panel title='A run record is not a running neighborhood.'>
					<p className='payment-muted'>
						This record is ready for local setup. Creating it does
						not launch a process, register agents, or purchase
						memberships. Use the isolated staging environment on
						your own machine.
					</p>
					<ol className='payment-list'>
						<li>
							From the repository root, provision this existing
							run:
							{safeRunId && (
								<pre>{`node --env-file=.env.staging.local scripts/seed-simulation.mjs --run-id ${run.id}`}</pre>
							)}
						</li>
						<li>
							Use the private credentials file reported by
							provisioning. New runs use the path below; the
							original baseline run uses{' '}
							<code>.state/staging-credentials.json</code>{' '}
							instead. Never paste the file’s contents into the
							dashboard.
						</li>
						<li>
							In PowerShell, enter the simulation directory, check
							the environment, and start the local process:
							{safeRunId && (
								<pre>{`Set-Location tools/simulation\n$env:SIM_CREDENTIALS = '.state/runs/${run.id}/credentials.json'\n$env:SIM_PROTECTION_BYPASS_FILE = '.state/protection.json'\n$env:SIM_MODE = '${run.mode === 'deterministic' ? 'deterministic' : 'autonomous'}'\n$env:SIM_POPULATION = '${run.agentCount}'\nnpm run preflight\nnpm start`}</pre>
							)}
						</li>
					</ol>
					<p className='admin-definition'>
						{run.mode === 'deterministic' ?
							'Deterministic scenarios do not require a model server.'
						:	'Autonomous runs require the configured local model server and sufficient available memory before starting.'
						}{' '}
						Only a fresh runner heartbeat confirms activity. Read
						<code> docs/simulation.md </code> for the full
						prerequisites and safe stop procedure.
					</p>
				</Panel>
			)}
			{control.error && (
				<Alert severity='error'>{control.error.message}</Alert>
			)}
			{control.data && (
				<Alert severity='info'>
					Command #{control.data.commandId} queued. The runner’s next
					state and control-applied event confirm when it takes
					effect.
				</Alert>
			)}
			{agentId && !selected ?
				<EmptyState
					title='Agent not found in this run.'
					href={`/admin/simulations/${id}`}
					action='Return to the run'>
					This agent may not have been registered by the runner yet.
				</EmptyState>
			: selected ?
				<>
					<div className='payment-grid payment-grid--two'>
						<Panel
							title='This individual member'
							action={<StatusPill status={selected.state} />}>
							<dl className='payment-details'>
								<div>
									<dt>Tier cohort</dt>
									<dd>{selected.tier}</dd>
								</div>
								<div>
									<dt>Completed cycles</dt>
									<dd>{selected.cycles}</dd>
								</div>
								<div>
									<dt>Last update</dt>
									<dd>
										<DateLabel value={selected.updatedAt} />
									</dd>
								</div>
							</dl>
							<p className='payment-muted'>
								{selected.lastAction ??
									'No action reported yet.'}
							</p>
							<div className='payment-actions'>
								<Link
									className='text-link'
									href={`/admin/users/${selected.userId}`}>
									Account & payments ↗
								</Link>
								<Link
									className='text-link'
									href={`/members/${selected.userId}`}>
									Public profile ↗
								</Link>
								<Button
									variant='outlined'
									disabled={controlsUnavailable}
									onClick={() =>
										control.mutate({
											runId: id,
											type:
												selected.state === 'paused' ?
													'resume_agent'
												:	'pause_agent',
											agentId: selected.id,
										})
									}>
									{selected.state === 'paused' ?
										'Resume agent'
									:	'Pause agent'}
								</Button>
							</div>
						</Panel>
						<Panel title='Persona & intentions'>
							<p className='admin-definition'>
								Declared synthetic persona, not a real person or
								a transcript of private model reasoning.
								Credentials and private tokens are excluded.
							</p>
							<details open>
								<summary>Persona specification</summary>
								<pre>
									{JSON.stringify(selected.persona, null, 2)}
								</pre>
							</details>
						</Panel>
					</div>
					<AdminActivity
						initial={{ runId: id, actorId: selected.userId }}
					/>
				</>
			:	<>
					<Panel title='Run controls'>
						<div className='payment-actions'>
							<Button
								variant='contained'
								disabled={
									controlsUnavailable ||
									run.status === 'running'
								}
								onClick={() =>
									control.mutate({
										runId: id,
										type:
											run.status === 'created' ?
												'start'
											:	'resume',
									})
								}>
								{run.status === 'created' ?
									'Request start'
								:	'Request resume'}
							</Button>
							<Button
								variant='outlined'
								disabled={
									controlsUnavailable ||
									run.status === 'paused' ||
									run.status === 'created'
								}
								onClick={() =>
									control.mutate({ runId: id, type: 'pause' })
								}>
								Pause run
							</Button>
							<Button
								variant='outlined'
								color='error'
								disabled={controlsUnavailable}
								onClick={() => setStopOpen(true)}>
								Stop & checkpoint
							</Button>
							<Link
								className='text-link'
								href={`/admin/activity?runId=${id}`}>
								Review recorded history ↗
							</Link>
						</div>
						<div
							className='admin-toolbar__filters'
							style={{ marginTop: 22 }}>
							<TextField
								select
								label='Requested inference concurrency'
								disabled={controlsUnavailable}
								value={concurrency}
								size='small'
								onChange={(event) =>
									setConcurrency(Number(event.target.value))
								}>
								{[1, 2].map((value) => (
									<MenuItem
										value={value}
										key={value}>
										{value} request{value > 1 ? 's' : ''}
									</MenuItem>
								))}
							</TextField>
							<Button
								disabled={controlsUnavailable}
								onClick={() =>
									control.mutate({
										runId: id,
										type: 'set_concurrency',
										value: concurrency,
									})
								}>
								Apply concurrency
							</Button>
							<TextField
								select
								label='Requested activity rate'
								disabled={controlsUnavailable}
								value={rate}
								size='small'
								onChange={(event) =>
									setRate(Number(event.target.value))
								}>
								{[0.1, 0.25, 0.5, 1, 2, 5].map((value) => (
									<MenuItem
										value={value}
										key={value}>
										{value}× pace
									</MenuItem>
								))}
							</TextField>
							<Button
								disabled={controlsUnavailable}
								onClick={() =>
									control.mutate({
										runId: id,
										type: 'set_rate',
										value: rate,
									})
								}>
								Apply pace
							</Button>
						</div>
						<p className='admin-definition'>
							{agents.length === 0 &&
								'Provision the run before requesting controls. '}
							Controls request work from the local runner; they
							cannot wake a sleeping computer. Pace changes each
							agent’s wake schedule, not the model server’s speed.
							Replay means reviewing recorded events; rerunning
							creates a new run.
						</p>
						<p className='payment-receipt-id'>
							Run identifier: {run.id}
						</p>
					</Panel>
					<div className='payment-grid'>
						<MetricCard
							label='Completed cycles'
							value={
								<NumericMetric
									values={metrics}
									name='cycles'
								/>
							}
							explanation='Runner-reported completed observe / decide / act cycles across all registered agents.'
							tone='leaf'
						/>
						<MetricCard
							label='Waiting for inference'
							value={
								<NumericMetric
									values={metrics}
									name='inferenceQueued'
								/>
							}
							explanation='Requests waiting for a shared local-model slot. Queued is not generating.'
							tone='saffron'
						/>
						<MetricCard
							label='Model requests active'
							value={
								<NumericMetric
									values={metrics}
									name='inferenceActive'
								/>
							}
							explanation='Inference requests actually occupying a local model slot at the last heartbeat.'
							tone='cobalt'
						/>
					</div>
					<div className='payment-grid payment-grid--two'>
						<Panel title='The laptop’s working room.'>
							<p className='admin-definition'>
								{online ?
									'Latest runner heartbeat measurements.'
								:	'Last received measurements; the runner is offline.'
								}{' '}
								System RAM includes other applications.
							</p>
							<ResourceBar
								label='System memory'
								used={usedRam}
								total={totalRam}
								unit='GiB'
							/>
							<ResourceBar
								label='GPU memory'
								used={metrics['gpuUsedMiB']}
								total={metrics['gpuTotalMiB']}
								unit='MiB'
							/>
							<dl className='payment-details'>
								<div>
									<dt>GPU utilization</dt>
									<dd>
										<NumericMetric
											values={metrics}
											name='gpuUtilizationPercent'
											suffix='%'
										/>
									</dd>
								</div>
								<div>
									<dt>Browser workers active</dt>
									<dd>
										<NumericMetric
											values={metrics}
											name='browserActive'
										/>
									</dd>
								</div>
								<div>
									<dt>Waiting for a browser</dt>
									<dd>
										<NumericMetric
											values={metrics}
											name='browserQueued'
										/>
									</dd>
								</div>
								<div>
									<dt>Model</dt>
									<dd>
										{typeof metrics['model'] === 'string' ?
											metrics['model']
										:	'Not reported'}
									</dd>
								</div>
							</dl>
						</Panel>
						<Panel title='What the agents are doing.'>
							{stateCounts.length ?
								<div>
									{stateCounts.map((item) => (
										<div
											className='admin-resource'
											key={item.state}>
											<div className='admin-resource__label'>
												<StatusPill
													status={item.state}
												/>
												<strong>
													{item.count} /{' '}
													{agents.length}
												</strong>
											</div>
											<progress
												value={item.count}
												max={agents.length}
												aria-label={`${item.count} agents ${item.state.replaceAll('_', ' ')}`}
											/>
										</div>
									))}
								</div>
							:	<p className='payment-muted'>
									The runner has not registered any agents
									yet.
								</p>
							}
						</Panel>
					</div>
					<Panel
						title={`${filtered.length} of ${agents.length} registered agents`}
						action={
							<div className='admin-toolbar__filters'>
								<TextField
									select
									size='small'
									label='Tier cohort'
									value={tier}
									sx={{ minWidth: 150 }}
									onChange={(event) =>
										setTier(event.target.value)
									}>
									<MenuItem value=''>All tiers</MenuItem>
									{['neighbor', 'supporter', 'sustainer'].map(
										(value) => (
											<MenuItem
												key={value}
												value={value}>
												{value}
											</MenuItem>
										),
									)}
								</TextField>
								<TextField
									select
									size='small'
									label='Agent state'
									value={state}
									sx={{ minWidth: 150 }}
									onChange={(event) =>
										setState(event.target.value)
									}>
									<MenuItem value=''>All states</MenuItem>
									{states.map((value) => (
										<MenuItem
											key={value}
											value={value}>
											{value.replaceAll('_', ' ')}
										</MenuItem>
									))}
								</TextField>
							</div>
						}>
						<p className='admin-definition'>
							Filters apply to the agent cards only. Run totals
							above include the whole population. Tier cohorts are
							simulation assignments; account billing records
							establish actual paid entitlements.
						</p>
						{filtered.length ?
							<div className='admin-agent-grid'>
								{filtered.map((agent) => (
									<Link
										className='admin-agent'
										key={agent.id}
										href={`/admin/simulations/${id}/agents/${agent.id}`}>
										<strong>{agent.name}</strong>
										<StatusPill status={agent.state} />
										<small>
											{agent.tier} · {agent.cycles} cycles
										</small>
										<small>
											{agent.lastAction ??
												'No action reported'}
										</small>
									</Link>
								))}
							</div>
						:	<EmptyState
								title={
									agents.length ?
										'No agents match these filters.'
									:	'Waiting for the local runner.'
								}>
								{agents.length ?
									'Choose All tiers and All states to see the full population.'
								:	'Run setup registers synthetic accounts and connects their individual agents. A run record alone does not create active users.'
								}
							</EmptyState>
						}
					</Panel>
					<AdminActivity initial={{ runId: id }} />
				</>
			}
			<Dialog
				open={stopOpen}
				onClose={() => {
					if (!commandPending) setStopOpen(false);
				}}
				maxWidth='sm'
				fullWidth
				aria-labelledby='stop-run-title'>
				<DialogTitle id='stop-run-title'>
					Stop this simulation?
				</DialogTitle>
				<DialogContent>
					The runner will finish or safely interrupt current work,
					save checkpoints, and stop scheduling agents. Hosted payment
					processing and historical records remain available. Confirm
					the stopped heartbeat before considering the process
					stopped.
				</DialogContent>
				<DialogActions>
					<Button
						disabled={commandPending}
						onClick={() => setStopOpen(false)}>
						Keep running
					</Button>
					<Button
						color='error'
						variant='contained'
						disabled={controlsUnavailable}
						onClick={() =>
							control.mutate({ runId: id, type: 'stop' })
						}>
						{commandPending ?
							'Requesting stop…'
						:	'Request stop & checkpoint'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
