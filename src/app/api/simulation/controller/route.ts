import {
	authenticateSimulation,
	simulationError,
} from '@/server/simulation/auth';
import { changeSimulationController } from '@/server/simulation/controller';
import { boundedJson } from '@/server/simulation/policy';
export const runtime = 'nodejs';
export async function POST(request: Request) {
	try {
		const actor = await authenticateSimulation(request, 'runner');
		return Response.json(
			await changeSimulationController(
				actor,
				await boundedJson(request, 2048),
			),
			{
				headers: { 'Cache-Control': 'no-store' },
			},
		);
	} catch (error) {
		return simulationError(error);
	}
}
