import { appendFileSync, closeSync, fsyncSync, openSync } from 'node:fs';

/** Durable supervision is independent of the tool's stdout pipe. No raw diagnostics. */
export class CommunitySupervision {
	readonly path: string;
	private outputAvailable = true;
	private writeOutput: (line: string) => void;
	constructor(path: string, writeOutput: (line: string) => void = (line) => { process.stdout.write(line); }) {
		this.path = path;
		this.writeOutput = writeOutput;
	}
	outputLost() { this.outputAvailable = false; }
	record(value: Record<string, unknown>) {
		const line = JSON.stringify({ recordedAt: new Date().toISOString(), ...value }) + '\n';
		appendFileSync(this.path, line);
		// Explicitly flush milestone records, not tens of thousands of action rows.
		if (value.terminal || value.started || value.progress || value.shutdownRequested) {
			const fd = openSync(this.path, 'r+');
			try { fsyncSync(fd); } finally { closeSync(fd); }
		}
		if (this.outputAvailable && (value.terminal || value.started || value.progress || value.shutdownRequested)) {
			try { this.writeOutput(line); } catch { this.outputLost(); }
		}
	}
}
