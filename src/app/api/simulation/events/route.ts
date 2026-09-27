import { simulationEvents } from '@/server/simulation/endpoints';
import { simulationError } from '@/server/simulation/auth';
export const runtime = 'nodejs';
export async function POST(request: Request) {
	try {
		return await simulationEvents(request);
	} catch (error) {
		return simulationError(error);
	}
}
