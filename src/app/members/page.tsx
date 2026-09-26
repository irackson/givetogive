import { getServerAuthSession } from '@/server/auth';
import { redirect } from 'next/navigation';

export default async function MembersPage() {
	const session = await getServerAuthSession();
	if (!session?.user.id) redirect('/signin?callbackUrl=/members');
	redirect(`/members/${session.user.id}`);
}
