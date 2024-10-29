'use client';

import { Box, Button } from '@mui/material';
import { useState } from 'react';
import { ClientFormFields } from './ClientFormFields';

export function CreateAskFormToggle() {
	const [showForm, setShowForm] = useState(false);

	const handleShowForm = () => {
		setShowForm(true);
	};

	const handleHideForm = () => {
		setShowForm(false);
	};

	return (
		<Box>
			{!showForm ? (
				<Button
					variant="contained"
					color="primary"
					onClick={handleShowForm}
				>
					Create New Ask
				</Button>
			) : (
				<Box>
					<ClientFormFields onCancel={handleHideForm} />
				</Box>
			)}
		</Box>
	);
}
