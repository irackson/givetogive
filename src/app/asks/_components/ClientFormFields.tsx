'use client';

import { ASK_TYPES, ASK_TYPE_LABELS, getAskUnitLabel } from '@/lib/asks';
import { varNameToHumanReadable } from '@/lib/utils/string-formatting';
import type { AppRouter } from '@/server/api/root';
import { api } from '@/trpc/react';
import {
	Alert,
	Button,
	FormControl,
	FormHelperText,
	InputLabel,
	MenuItem,
	Select,
	Slider,
	Stack,
	TextField,
	Typography,
} from '@mui/material';
import { useForm } from '@tanstack/react-form';
import type { inferRouterInputs } from '@trpc/server';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';

type FormValues = inferRouterInputs<AppRouter>['ask']['createAsk'];

interface ClientFormFieldsProps {
	onCancel?: () => void;
}

function formatFieldErrors(errors: unknown[]) {
	return errors
		.flatMap((error) => {
			if (typeof error === 'string') return error;
			if (error && typeof error === 'object' && 'message' in error) {
				return String(error.message);
			}
			return [];
		})
		.join(', ');
}

export function ClientFormFields({ onCancel }: ClientFormFieldsProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const estimatedMinutes = searchParams.get('estimatedMinutesToComplete');
	const difficultyParam = searchParams.get('difficulty');
	const defaultValues: FormValues = {
		title: searchParams.get('title') ?? '',
		description: searchParams.get('description') ?? '',
		type: 'task',
		goalAmount: 1,
		currency: 'USD',
		difficulty: difficultyParam ? Number.parseInt(difficultyParam) : 1,
		estimatedMinutesToComplete:
			estimatedMinutes ? Number.parseInt(estimatedMinutes) : 30,
	};

	const utils = api.useUtils();
	const createAskMutation = api.ask.createAsk.useMutation({
		onSuccess: async ({ newlyCreatedSlug }) => {
			await utils.ask.getAsks.invalidate();
			router.push(`/asks/${newlyCreatedSlug}`);
		},
	});

	const { Field, Subscribe, handleSubmit, reset } = useForm({
		defaultValues,
		validators: {
			onChange: z
				.object({
					title: z.string().min(3),
					description: z.string().min(10),
					type: z.enum(ASK_TYPES),
					goalAmount: z.number().positive(),
					currency: z.string().length(3),
					difficulty: z.number().int().min(1).max(5),
					estimatedMinutesToComplete: z.number().int().positive(),
				})
				.superRefine(({ goalAmount, type }, ctx) => {
					if (type !== 'money' && !Number.isInteger(goalAmount)) {
						ctx.addIssue({
							code: 'custom',
							message: 'Use a whole number for this Ask type.',
							path: ['goalAmount'],
						});
					}
				}),
		},
		onSubmit: ({ value }) => createAskMutation.mutate(value),
	});

	return (
		<Stack
			component='form'
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void handleSubmit();
			}}
			spacing={2}>
			<Typography
				component='h2'
				variant='h5'>
				Create a new Ask
			</Typography>
			<Field name='title'>
				{({ name, state, handleChange, handleBlur }) => (
					<TextField
						label={varNameToHumanReadable(name)}
						value={state.value}
						onChange={(event) => handleChange(event.target.value)}
						onBlur={handleBlur}
						error={
							state.meta.isTouched && state.meta.errors.length > 0
						}
						helperText={formatFieldErrors(state.meta.errors)}
						fullWidth
					/>
				)}
			</Field>
			<Field name='description'>
				{({ name, state, handleChange, handleBlur }) => (
					<TextField
						label={varNameToHumanReadable(name)}
						value={state.value}
						onChange={(event) => handleChange(event.target.value)}
						onBlur={handleBlur}
						error={
							state.meta.isTouched && state.meta.errors.length > 0
						}
						helperText={formatFieldErrors(state.meta.errors)}
						fullWidth
						multiline
						rows={4}
					/>
				)}
			</Field>
			<Field name='type'>
				{({ state, handleChange }) => (
					<FormControl fullWidth>
						<InputLabel id='ask-type-label'>Ask type</InputLabel>
						<Select
							labelId='ask-type-label'
							label='Ask type'
							value={state.value}
							onChange={(event) =>
								handleChange(
									event.target.value as FormValues['type'],
								)
							}>
							{ASK_TYPES.map((type) => (
								<MenuItem
									key={type}
									value={type}>
									{ASK_TYPE_LABELS[type]}
								</MenuItem>
							))}
						</Select>
					</FormControl>
				)}
			</Field>
			<Subscribe selector={(state) => state.values.type}>
				{(type) => (
					<>
						<Field name='goalAmount'>
							{({ state, handleChange, handleBlur }) => (
								<TextField
									label={
										type === 'money' ? 'Monetary goal' : (
											`Goal (${getAskUnitLabel(type)})`
										)
									}
									value={state.value}
									onChange={(event) =>
										handleChange(Number(event.target.value))
									}
									onBlur={handleBlur}
									error={
										state.meta.isTouched &&
										state.meta.errors.length > 0
									}
									helperText={formatFieldErrors(
										state.meta.errors,
									)}
									inputProps={{
										min: type === 'money' ? 0.01 : 1,
										step: type === 'money' ? 0.01 : 1,
									}}
									type='number'
									fullWidth
								/>
							)}
						</Field>
						{type === 'money' && (
							<Field name='currency'>
								{({ state, handleChange, handleBlur }) => (
									<TextField
										label='Currency'
										value={state.value}
										onChange={(event) =>
											handleChange(
												event.target.value.toUpperCase(),
											)
										}
										onBlur={handleBlur}
										inputProps={{ maxLength: 3 }}
										fullWidth
									/>
								)}
							</Field>
						)}
					</>
				)}
			</Subscribe>
			<Field name='estimatedMinutesToComplete'>
				{({ name, state, handleChange, handleBlur }) => (
					<TextField
						label={varNameToHumanReadable(name)}
						value={state.value}
						onChange={(event) =>
							handleChange(Number.parseInt(event.target.value))
						}
						onBlur={handleBlur}
						error={
							state.meta.isTouched && state.meta.errors.length > 0
						}
						helperText={formatFieldErrors(state.meta.errors)}
						inputProps={{ min: 1 }}
						type='number'
						fullWidth
					/>
				)}
			</Field>
			<Field name='difficulty'>
				{({ name, state, handleChange }) => (
					<>
						<Typography>
							{varNameToHumanReadable(name)}: {state.value}/5
						</Typography>
						<Slider
							aria-label='Difficulty'
							value={state.value}
							onChange={(__event, value) =>
								handleChange(value as number)
							}
							min={1}
							max={5}
							step={1}
							marks
							valueLabelDisplay='auto'
						/>
						{state.meta.isTouched &&
							state.meta.errors.length > 0 && (
								<FormHelperText error>
									{formatFieldErrors(state.meta.errors)}
								</FormHelperText>
							)}
					</>
				)}
			</Field>
			{createAskMutation.error && (
				<Alert severity='error'>
					{createAskMutation.error.message}
				</Alert>
			)}
			<Stack
				direction='row'
				spacing={1}>
				<Button
					type='submit'
					variant='contained'
					disabled={createAskMutation.isPending}>
					{createAskMutation.isPending ? 'Creating...' : 'Create Ask'}
				</Button>
				{onCancel && (
					<Button
						variant='outlined'
						onClick={() => {
							reset();
							onCancel();
						}}>
						Cancel
					</Button>
				)}
			</Stack>
		</Stack>
	);
}
