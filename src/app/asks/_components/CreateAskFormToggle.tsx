'use client';

import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded';
import { Box, Button, Dialog, DialogContent } from '@mui/material';
import { useState } from 'react';

import { ClientFormFields } from './ClientFormFields';

export function CreateAskFormToggle({
	isAuthenticated,
}: {
	isAuthenticated: boolean;
}) {
	const [showForm, setShowForm] = useState(false);

	if (!isAuthenticated) {
		return (
			<Button
				id='start-an-ask'
				variant='contained'
				href='/signin?callbackUrl=/asks'
				startIcon={<AddCircleOutlineRoundedIcon />}>
				Sign in to post an ask
			</Button>
		);
	}

	return (
		<Box id='start-an-ask'>
			<Button
				variant='contained'
				color='secondary'
				startIcon={<AddCircleOutlineRoundedIcon />}
				onClick={() => setShowForm(true)}>
				Post an ask
			</Button>
			<Dialog
				open={showForm}
				onClose={() => setShowForm(false)}
				fullWidth
				maxWidth='sm'>
				<DialogContent sx={{ p: { xs: 3, sm: 4 } }}>
					<ClientFormFields onCancel={() => setShowForm(false)} />
				</DialogContent>
			</Dialog>
		</Box>
	);
}
