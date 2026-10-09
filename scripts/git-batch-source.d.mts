export function authoredGitTraversal(paths: readonly string[]): string[];
export function fingerprintGitBatch(bytes: Buffer, expected: readonly { path: string; object: string }[]): string;
export function batchedGitSourceFingerprint(repositoryRoot: string, commit: string): string;
