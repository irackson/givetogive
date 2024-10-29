'use client';

import { Button, TextField } from '@mui/material';
import { useForm } from '@tanstack/react-form';
import { zodValidator } from '@tanstack/zod-form-adapter';
import type { inferRouterInputs } from '@trpc/server';
import { varNameToHumanReadable } from 'code/lib/utils/string-formatting';
import type { AppRouter } from 'code/server/api/root';
import { api } from 'code/trpc/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';

type FormValues = inferRouterInputs<AppRouter>['ask']['createAsk'];

interface ClientFormFieldsProps {
	onCancel?: () => void;
}

export function ClientFormFields({ onCancel }: ClientFormFieldsProps) {
	const router = useRouter();
	const searchParams = useSearchParams();

	// Extract default values from URL parameters
	const estimatedMinutes = searchParams.get('estimatedMinutesToComplete');
	const defaultValues: FormValues = {
		title: searchParams.get('title') ?? '',
		description: searchParams.get('description') ?? '',
		estimatedMinutesToComplete: estimatedMinutes
			? parseInt(estimatedMinutes)
			: 0,
	};

	// Initialize the createAsk mutation
	const createAskMutation = api.ask.createAsk.useMutation({
		onSuccess: ({
			newlyCreatedAskId: __newlyCreatedAskId,
			newlyCreatedSlug,
		}) => {
			router.push(`/asks/${newlyCreatedSlug}`);
			api.ask.getAsks.usePrefetchQuery({
				/* TODO: once have access to session, use filter for logged in user */
			});
		},
	});

	// Set up the form using useForm with validatorAdapter
	const { Field, handleSubmit, reset } = useForm({
		defaultValues,
		validatorAdapter: zodValidator(),
		validators: {
			// onChange: createAskFormInputValidation,
			onChange: z.object({
				title: z.string().min(3),
				description: z.string().min(10),
				estimatedMinutesToComplete: z.number().int().min(1),
			}),
		},
		onSubmit: ({ value }) => {
			// if (!session) {
			// 	// User not logged in: redirect to login with form data in callback URL
			// 	const callbackUrl = `/asks/create?${serializeFormValues(value)}`;
			// 	router.push(
			// 		`/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
			// 	);
			// } else {
			// 	// User is logged in: submit the form
			// }

			if (value) {
				createAskMutation.mutate(value);
			} else {
				console.log('Why is this submitting with no value?');
			}
		},
	});

	// Helper function to serialize form values into URL parameters
	function serializeFormValues(values: FormValues) {
		const params = new URLSearchParams();
		params.set('title', values.title);
		params.set('description', values.description);
		params.set(
			'estimatedMinutesToComplete',
			values.estimatedMinutesToComplete.toString(),
		);
		return params.toString();
	}

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				void handleSubmit();
			}}
		>
			<Field
				name="title"
				children={({
					name,
					state: {
						value,
						meta: { errors },
					},
					handleChange,
					handleBlur,
				}) => (
					<TextField
						label={`${varNameToHumanReadable(name)}`}
						value={value}
						onChange={(e) => handleChange(e.target.value)}
						onBlur={handleBlur}
						error={errors.length > 0}
						helperText={errors.join(', ')}
						fullWidth
						margin="normal"
					/>
				)}
			/>
			<Field
				name="description"
				children={({
					name,
					state: {
						value,
						meta: { errors },
					},
					handleChange,
					handleBlur,
				}) => (
					<TextField
						label={`${varNameToHumanReadable(name)}`}
						value={value}
						onChange={(e) => handleChange(e.target.value)}
						onBlur={handleBlur}
						error={errors.length > 0}
						helperText={errors.join(', ')}
						fullWidth
						margin="normal"
						multiline
						rows={4}
					/>
				)}
			/>
			<Field
				name="estimatedMinutesToComplete"
				children={({
					name,
					state: {
						value,
						meta: { errors },
					},
					handleChange,
					handleBlur,
				}) => (
					<TextField
						label={`${varNameToHumanReadable(name)}`}
						value={value}
						onChange={(e) => handleChange(parseInt(e.target.value))}
						onBlur={handleBlur}
						error={errors.length > 0}
						helperText={errors.join(', ')}
						type="number"
						fullWidth
						margin="normal"
					/>
				)}
			/>
			<Button
				type="submit"
				variant="contained"
				color="primary"
				disabled={createAskMutation.status === 'pending'}
			>
				Submit
			</Button>
			{onCancel && (
				<Button
					variant="outlined"
					color="secondary"
					onClick={() => {
						reset();
						onCancel();
					}}
				>
					Cancel
				</Button>
			)}
		</form>
	);
}
