import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
	authenticateSimulation,
	simulationError,
} from '@/server/simulation/auth';
import { createMemberMcpServer } from '@/server/mcp/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
	try {
		const actor = await authenticateSimulation(request, 'agent');
		const server = createMemberMcpServer(actor, request.headers);
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
			maxRequestBodySize: 65_536,
		});
		try {
			await server.connect(transport);
			const response = await transport.handleRequest(request);
			response.headers.set('Cache-Control', 'no-store');
			return response;
		} finally {
			await server.close();
		}
	} catch (error) {
		return simulationError(error);
	}
}
export async function GET(request: Request) {
	try {
		await authenticateSimulation(request, 'agent');
		return new Response(null, {
			status: 405,
			headers: { 'Allow': 'POST', 'Cache-Control': 'no-store' },
		});
	} catch (error) {
		return simulationError(error);
	}
}
export const DELETE = GET;
