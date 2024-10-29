import { type Session } from 'next-auth';
import React from 'react';

export interface NavContextType {
	session: Session | null;
}

export const NavContext = React.createContext<NavContextType>({
	session: null,
});
