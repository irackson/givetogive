import { z } from 'zod';

export const credentialsSchema = z.object({
	email: z.string().trim().toLowerCase().email().max(255),
	password: z.string().min(8).max(128),
});

export const registrationSchema = credentialsSchema.extend({
	name: z.string().trim().min(1, 'Name is required').max(100),
});
