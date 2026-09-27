'use client';

import { api } from '@/trpc/react';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import {
	Alert,
	Button,
	Checkbox,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	FormControlLabel,
	Stack,
	TextField,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function ProfileEditor({
	bio,
	location,
	name,
	showSupporterBadge,
	supporterTier,
	recognitionStatus,
}: {
	bio: string | null;
	location: string | null;
	name: string;
	showSupporterBadge: boolean;
	supporterTier: 'neighbor' | 'supporter' | 'sustainer';
	recognitionStatus: 'ready' | 'pending';
}) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [saved, setSaved] = useState(false);
	const [draftName, setDraftName] = useState(name);
	const [draftBio, setDraftBio] = useState(bio ?? '');
	const [draftLocation, setDraftLocation] = useState(location ?? '');
	const [draftBadge, setDraftBadge] = useState(showSupporterBadge);
	const updateProfile = api.user.updateProfile.useMutation({
		onSuccess: () => {
			setIsOpen(false);
			setSaved(true);
			router.refresh();
		},
	});
	const openEditor = () => {
		setDraftName(name);
		setDraftBio(bio ?? '');
		setDraftLocation(location ?? '');
		setDraftBadge(showSupporterBadge);
		updateProfile.reset();
		setSaved(false);
		setIsOpen(true);
	};
	const closeEditor = () => {
		if (!updateProfile.isPending) setIsOpen(false);
	};
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!updateProfile.isPending)
			updateProfile.mutate({
				name: draftName,
				bio: draftBio,
				location: draftLocation,
				showSupporterBadge: draftBadge,
			});
	};
	return (
		<div className='profile-editor'>
			<Button
				onClick={openEditor}
				variant='outlined'
				startIcon={<EditRoundedIcon />}>
				Edit profile
			</Button>
			{saved && <p role='status'>Profile saved.</p>}
			<Dialog
				open={isOpen}
				onClose={closeEditor}
				fullWidth
				maxWidth='sm'
				aria-labelledby='profile-editor-title'
				aria-describedby='profile-editor-privacy'>
				<form onSubmit={submit}>
					<DialogTitle id='profile-editor-title'>
						Tell neighbors about yourself
					</DialogTitle>
					<DialogContent>
						<Stack
							spacing={2}
							sx={{ pt: 1 }}>
							<p id='profile-editor-privacy'>
								Your name, introduction, and neighborhood are
								public. Share a city or neighborhood rather than
								your home address.
							</p>
							<TextField
								label='Name'
								value={draftName}
								onChange={(event) =>
									setDraftName(event.target.value)
								}
								slotProps={{
									htmlInput: { maxLength: 80, minLength: 2 },
								}}
								required
								autoFocus
								disabled={updateProfile.isPending}
							/>
							<TextField
								label='Neighborhood or city'
								value={draftLocation}
								onChange={(event) =>
									setDraftLocation(event.target.value)
								}
								slotProps={{ htmlInput: { maxLength: 120 } }}
								disabled={updateProfile.isPending}
							/>
							<TextField
								label='About you'
								value={draftBio}
								onChange={(event) =>
									setDraftBio(event.target.value)
								}
								slotProps={{ htmlInput: { maxLength: 500 } }}
								helperText={`${draftBio.length}/500`}
								multiline
								rows={4}
								disabled={updateProfile.isPending}
							/>
							<FormControlLabel
								control={
									<Checkbox
										checked={draftBadge}
										onChange={(event) =>
											setDraftBadge(event.target.checked)
										}
										disabled={updateProfile.isPending}
									/>
								}
								label='Show my supporter badge on my public profile'
							/>
							<p className='profile-history__explanation'>
								{recognitionStatus === 'pending' ?
									'Your paid recognition is being reconciled. This does not mean your membership was downgraded. Your badge preference is preserved while verification completes.'
								: supporterTier === 'neighbor' ?
									'You currently participate as a free Neighbor. Your preference will apply if you become a paid supporter.'
								:	`Your current paid recognition is ${supporterTier === 'sustainer' ? 'Sustainer' : 'Supporter'}.`
								}{' '}
								A badge appears only while paid support is
								recognized. It is not identity verification, a
								safety rating, or priority for receiving help.
							</p>
							{updateProfile.error && (
								<Alert severity='error'>
									{updateProfile.error.message}
								</Alert>
							)}
						</Stack>
					</DialogContent>
					<DialogActions sx={{ px: 3, pb: 3 }}>
						<Button
							onClick={closeEditor}
							disabled={updateProfile.isPending}>
							Cancel
						</Button>
						<Button
							type='submit'
							variant='contained'
							disabled={
								updateProfile.isPending ||
								draftName.trim().length < 2
							}>
							{updateProfile.isPending ?
								'Saving…'
							:	'Save profile'}
						</Button>
					</DialogActions>
				</form>
			</Dialog>
		</div>
	);
}
