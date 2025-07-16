'use client';

import { api } from '@/trpc/react';
import { Box, Button, TextField } from '@mui/material';
import { useState } from 'react';

export default function SignupPage() {
        const register = api.user.register.useMutation();
        const [email, setEmail] = useState('');
        const [password, setPassword] = useState('');
        const [name, setName] = useState('');

        return (
                <Box
                        component='form'
                        onSubmit={(e) => {
                                e.preventDefault();
                                register.mutate({ email, password, name });
                        }}>
                        <TextField
                                label='Email'
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                fullWidth
                                margin='normal'
                        />
                        <TextField
                                label='Password'
                                type='password'
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                fullWidth
                                margin='normal'
                        />
                        <TextField
                                label='Name'
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                fullWidth
                                margin='normal'
                        />
                        <Button type='submit' variant='contained' sx={{ mt: 2 }}>
                                Sign Up
                        </Button>
                </Box>
        );
}
