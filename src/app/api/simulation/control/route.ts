import { simulationControl } from '@/server/simulation/endpoints';
import { simulationError } from '@/server/simulation/auth';
export const runtime = 'nodejs';
export async function GET(request: Request) {
	try {
		return await simulationControl(request);
	} catch (error) {
		return simulationError(error);
	}
}
