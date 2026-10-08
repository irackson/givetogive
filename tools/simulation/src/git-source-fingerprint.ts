import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.js', 'postcss.config.cjs', 'tailwind.config.ts'];

/** Match readdir().sort() recursive traversal, NOT a flat full-path sort.
 * A directory named foo is visited before its sibling foo.ts, even though
 * a flat path sort would place foo.ts before foo/bar.ts. */
export function authoredTraversal(paths: readonly string[]): string[] {
 const files = new Set(paths);
 if (files.size !== paths.length || paths.some(path => !path || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')))
  throw Error('Invalid Git source paths.');
 const directories = new Map<string, Set<string>>();
 for (const path of paths) {
  const pieces = path.split('/');
  for (let i = 0; i < pieces.length; i++) {
   const parent = pieces.slice(0,i).join('/');
   const children = directories.get(parent) ?? new Set<string>();
   children.add(pieces[i]!); directories.set(parent,children);
  }
 }
 const result: string[] = [];
 function visit(path: string) {
  if (path === 'src/app/.well-known/workflow' || path.startsWith('src/app/.well-known/workflow/')) return;
  const children = directories.get(path);
  if (children && files.has(path)) throw Error('Git source path collision.');
  if (children) for (const child of [...children].sort()) visit(`${path}/${child}`);
  else if (files.has(path)) result.push(path);
 }
 for (const root of roots) visit(root);
 return result;
}

/** Read canonical blobs without checkout writes, filters, credentials or generated files. */
export function gitSourceFingerprint(repositoryRoot: string, commit: string): string {
 if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Exact commit required.');
 const entries = execFileSync('git',['ls-tree','-rz',commit],{cwd:repositoryRoot,maxBuffer:20*1024*1024}).toString('utf8').split('\0').filter(Boolean);
 const blobs = new Map<string,string>();
 for (const entry of entries) {
  const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(entry);
  if (!match) throw Error('Invalid Git tree entry.');
  const [,mode,type,object,path] = match;
  if (!roots.some(root => path === root || path!.startsWith(`${root}/`))) continue;
  if (path === 'src/app/.well-known/workflow' || path!.startsWith('src/app/.well-known/workflow/')) continue;
  if (type !== 'blob' || !['100644','100755'].includes(mode!)) throw Error('Linked source rejected.');
  blobs.set(path!,object!);
 }
 const hash = createHash('sha256');
 for (const path of authoredTraversal([...blobs.keys()])) {
  const bytes = execFileSync('git',['cat-file','blob',blobs.get(path)!],{cwd:repositoryRoot,maxBuffer:20*1024*1024});
  hash.update(path).update('\0').update(bytes).update('\0');
 }
 return hash.digest('hex');
}
