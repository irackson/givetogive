'use client';

import { Box, Button } from '@mui/material';
import { useState } from 'react';

import { ClientFormFields } from './ClientFormFields';

export function CreateAskFormToggle({
	isAuthenticated,
}: {
	isAuthenticated: boolean;
}) {
	const [showForm, setShowForm] = useState(false);

	const handleShowForm = () => {
		setShowForm(true);
	};

	const handleHideForm = () => {
		setShowForm(false);
	};

	return (
		<Box>
			{!isAuthenticated ?
				<Button
					variant='contained'
					href='/signin?callbackUrl=/asks'>
					Sign in to create an Ask
				</Button>
			: !showForm ?
				<Button
					variant='contained'
					color='primary'
					onClick={handleShowForm}>
					Create New Ask
				</Button>
			:	<Box sx={{ width: { xs: '100%', sm: 560 } }}>
					<ClientFormFields onCancel={handleHideForm} />
				</Box>
			}
		</Box>
	);
}
