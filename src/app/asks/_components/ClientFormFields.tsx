'use client';

import { varNameToHumanReadable } from '@/lib/utils/string-formatting';
import type { AppRouter } from '@/server/api/root';
import { api } from '@/trpc/react';
import {
	Button,
	FormHelperText,
	Slider,
	TextField,
	Typography,
} from '@mui/material';
import { useForm } from '@tanstack/react-form';
import { zodValidator } from '@tanstack/zod-form-adapter';
import type { inferRouterInputs } from '@trpc/server';
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
	const difficultyParam = searchParams.get('difficulty');
	const defaultValues: FormValues = {
		title: searchParams.get('title') ?? '',
		description: searchParams.get('description') ?? '',
		difficulty:
			typeof difficultyParam === 'string' ? parseInt(difficultyParam) : 1,
		estimatedMinutesToComplete:
			typeof estimatedMinutes === 'string' ?
				parseInt(estimatedMinutes)
			:	0,
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
				title: z
					.string()
					.min(3)
					.refine((v) => !/^\d+$/.test(v), {
						message: 'The title cannot solely consist of numbers',
					}),
				description: z.string().min(10),
				difficulty: z.number().int().min(1).max(5),
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

			createAskMutation.mutate(value);
		},
	});

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	function serializeFormValues(values: FormValues) {
		// Helper function to serialize form values into URL parameters
		const params = new URLSearchParams();
		params.set('title', values.title);
		params.set('description', values.description);
		params.set('difficulty', String(values.difficulty));
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
			}}>
			<Field
				name='title'
				children={({
					name,
					state: {
						value,
						meta: { errors, isTouched },
					},
					handleChange,
					handleBlur,
				}) => (
					<TextField
						label={`${varNameToHumanReadable(name)}`}
						value={value}
						onChange={(e) => handleChange(e.target.value)}
						onBlur={handleBlur}
						error={isTouched && errors.length > 0}
						helperText={errors.join(', ')}
						fullWidth
						margin='normal'
					/>
				)}
			/>
			<Field
				name='description'
				children={({
					name,
					state: {
						value,
						meta: { errors, isTouched },
					},
					handleChange,
					handleBlur,
				}) => (
					<TextField
						label={`${varNameToHumanReadable(name)}`}
						value={value}
						onChange={(e) => handleChange(e.target.value)}
						onBlur={handleBlur}
						error={isTouched && errors.length > 0}
						helperText={errors.join(', ')}
						fullWidth
						margin='normal'
						multiline
						rows={4}
					/>
				)}
			/>
			<Field
				name='estimatedMinutesToComplete'
				children={({
					name,
					state: {
						value,
						meta: { errors, isTouched },
					},
					handleChange,
					handleBlur,
				}) => (
					<TextField
						label={`${varNameToHumanReadable(name)}`}
						value={value}
						onChange={(e) => handleChange(parseInt(e.target.value))}
						onBlur={handleBlur}
						error={isTouched && errors.length > 0}
						helperText={errors.join(', ')}
						type='number'
						fullWidth
						margin='normal'
					/>
				)}
			/>
			<Field
				name='difficulty'
				children={({
					name,
					state: {
						value,
						meta: { errors, isTouched },
					},
					handleChange,
				}) => (
					<>
						<Typography gutterBottom>
							{varNameToHumanReadable(name)}
						</Typography>
						<Slider
							value={value}
							onChange={(__e, newValue) =>
								handleChange(newValue as number)
							}
							min={1}
							max={5}
							step={1}
							valueLabelDisplay='auto'
						/>
						{isTouched && errors.length > 0 && (
							<FormHelperText error>
								{errors.join(', ')}
							</FormHelperText>
						)}
					</>
				)}
			/>
			<Button
				type='submit'
				variant='contained'
				color='primary'
				disabled={createAskMutation.status === 'pending'}>
				Submit
			</Button>
			{onCancel && (
				<Button
					variant='outlined'
					color='secondary'
					onClick={() => {
						reset();
						onCancel();
					}}>
					Cancel
				</Button>
			)}
		</form>
	);
}
