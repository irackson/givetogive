'use client';

import { useRef, useState } from 'react';
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
import { api } from '@/trpc/react';
import { PaymentLoading } from './PaymentPrimitives';
import { QueryError } from './AdminPrimitives';
import { AdminElevation } from './SecuritySettings';

export function CaseReview({ caseId }: { caseId: string }) {
	const [open, setOpen] = useState(false);
	const [note, setNote] = useState('');
	const [decision, setDecision] = useState<'acknowledge' | 'escalate'>(
		'acknowledge',
	);
	const [beforeId, setBeforeId] = useState<number | undefined>();
	const operationId = useRef<string | undefined>(undefined);
	const history = api.cases.history.useQuery(
		{ caseId, ...(beforeId ? { beforeId } : {}), limit: 30 },
		{ enabled: open },
	);
	const review = api.cases.review.useMutation({
		onSuccess: () => {
			operationId.current = undefined;
			setNote('');
			setBeforeId(undefined);
			void history.refetch();
		},
	});
	const close = () => {
		if (!review.isPending) setOpen(false);
	};
	return (
		<>
			<Button
				size='small'
				variant='outlined'
				onClick={() => {
					setOpen(true);
					review.reset();
					operationId.current = undefined;
				}}>
				Review case
			</Button>
			<Dialog
				open={open}
				onClose={close}
				fullWidth
				maxWidth='sm'
				aria-labelledby={`case-review-${caseId}`}>
				<DialogTitle id={`case-review-${caseId}`}>
					Review recovery case
				</DialogTitle>
				<DialogContent className='payment-stack'>
					<Alert severity='info'>
						Acknowledging or escalating records your review only. It
						does not resolve this case, release reserved money, or
						mark a payment successful.
					</Alert>
					{history.isPending ?
						<PaymentLoading />
					: history.error ?
						<QueryError
							message='Case history could not load.'
							retry={() => void history.refetch()}
						/>
					:	history.data && (
							<>
								<p>{history.data.item.summary}</p>
								<p className='payment-muted'>
									Provider recovery state:{' '}
									{history.data.item.resolvedAt ?
										'resolved by reconciliation'
									:	'unresolved'}
									.
								</p>
								<h3>Recorded operator history</h3>
								{history.data.items.length ?
									<ul className='payment-list'>
										{history.data.items.map((event) => (
											<li key={event.id}>
												<strong>
													{(
														event.action ===
														'payment_case_escalated'
													) ?
														'Escalated'
													:	'Acknowledged'}
												</strong>
												<p>{event.summary}</p>
												<small>
													Admin {event.actorId} ·{' '}
													<time
														dateTime={new Date(
															event.occurredAt,
														).toISOString()}>
														{new Date(
															event.occurredAt,
														).toLocaleString()}
													</time>
												</small>
											</li>
										))}
									</ul>
								:	<p className='payment-muted'>
										No operator reviews recorded yet.
									</p>
								}
								<div className='payment-row'>
									{beforeId && (
										<Button
											onClick={() =>
												setBeforeId(undefined)
											}>
											Newest reviews
										</Button>
									)}
									{history.data.nextCursor && (
										<Button
											onClick={() =>
												setBeforeId(
													history.data!.nextCursor!,
												)
											}>
											Older reviews
										</Button>
									)}
								</div>
							</>
						)
					}
					<TextField
						select
						label='Review action'
						value={decision}
						disabled={review.isPending}
						onChange={(event) =>
							setDecision(
								event.target.value as
									'acknowledge' | 'escalate',
							)
						}>
						<MenuItem value='acknowledge'>Acknowledge</MenuItem>
						<MenuItem value='escalate'>
							Escalate for investigation
						</MenuItem>
					</TextField>
					<TextField
						label='Review note'
						multiline
						minRows={3}
						value={note}
						disabled={review.isPending}
						inputProps={{ maxLength: 500 }}
						helperText='10-500 characters. Do not include passwords, banking details, payment card data, or private links.'
						onChange={(event) => setNote(event.target.value)}
					/>
					<AdminElevation />
					{review.error && (
						<Alert severity='error'>{review.error.message}</Alert>
					)}
					{review.isSuccess && (
						<Alert severity='success'>
							Review recorded. Financial state was not changed.
						</Alert>
					)}
				</DialogContent>
				<DialogActions>
					<Button
						onClick={close}
						disabled={review.isPending}>
						Close
					</Button>
					<Button
						variant='contained'
						disabled={
							review.isPending ||
							!history.data ||
							note.trim().length < 10
						}
						onClick={() => {
							operationId.current ??= crypto.randomUUID();
							review.mutate({
								caseId,
								decision,
								note: note.trim(),
								operationId: operationId.current,
							});
						}}>
						{review.isPending ? 'Recording…' : 'Record review'}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
}
