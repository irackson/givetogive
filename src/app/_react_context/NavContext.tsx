import { type Session } from 'next-auth';
import { createContext } from 'react';

export interface NavContextType {
	session: Session | null;
}

export const NavContext = createContext<NavContextType>({
	session: null,
});
