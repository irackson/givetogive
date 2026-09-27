import { simulationClockCommand } from '@/server/simulation/clocks';
import { simulationError } from '@/server/simulation/auth';
export const runtime = 'nodejs';
export async function POST(request: Request) {
	try {
		return await simulationClockCommand(request);
	} catch (error) {
		return simulationError(error);
	}
}
