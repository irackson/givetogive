import { simulationManifest } from '@/server/simulation/endpoints';
import { simulationError } from '@/server/simulation/auth';
export const runtime = 'nodejs';
export async function GET(request: Request) {
	try {
		return await simulationManifest(request);
	} catch (error) {
		return simulationError(error);
	}
}
