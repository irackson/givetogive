/** Canonical Git blobs only. No checkout, filters, credentials or remote calls. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const maximumBytes = 128 * 1024 * 1024;
const roots = ['src','public','package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.js','postcss.config.cjs','tailwind.config.ts'];
/** @param {unknown} condition @returns {asserts condition} */
function guard(condition) { if (!condition) throw Error('Canonical Git source rejected.'); }
/** @param {readonly string[]} paths */
export function authoredGitTraversal(paths) {
 const files = new Set(paths);
 /** @type {Map<string,Set<string>>} */ const directories = new Map();
 guard(files.size === paths.length && paths.every(path => typeof path === 'string' && path && !path.includes('\\') &&
  !path.includes('\0') && path.split('/').every(part => part && part !== '.' && part !== '..')));
 for (const path of paths) { const pieces = path.split('/');
  for (let i = 0; i < pieces.length; i++) { const parent = pieces.slice(0,i).join('/');
   const children = directories.get(parent) ?? new Set(); children.add(pieces[i]); directories.set(parent,children); }
 }
 /** @type {string[]} */ const result = [];
 /** @param {string} path */
 function visit(path) {
  if (path === 'src/app/.well-known/workflow' || path.startsWith('src/app/.well-known/workflow/')) return;
  const children = directories.get(path); guard(!children || !files.has(path));
  if (children) for (const child of [...children].sort()) visit(`${path}/${child}`);
  else if (files.has(path)) result.push(path);
 }
 for (const root of roots) visit(root); return result;
}
/** Strict binary framing; output can contain newlines, NULs and image bytes.
 * @param {Buffer} bytes @param {readonly {path:string,object:string}[]} expected */
export function fingerprintGitBatch(bytes, expected) {
 guard(Buffer.isBuffer(bytes) && bytes.length <= maximumBytes && expected.length > 0 && expected.length <= 10000);
 const paths = expected.map(entry => entry.path), ordered = authoredGitTraversal(paths);
 guard(ordered.length === paths.length && ordered.every((path,index) => path === paths[index]));
 const hash = createHash('sha256'); let cursor = 0;
 for (const entry of expected) {
  guard(/^[a-f0-9]{40}$/.test(entry.object));
  const end = bytes.indexOf(10,cursor); guard(end >= cursor && end - cursor <= 100);
  const header = bytes.subarray(cursor,end).toString('ascii');
  const match = /^([a-f0-9]{40}) blob (0|[1-9][0-9]{0,8})$/.exec(header);
  guard(match && match[1] === entry.object);
  const size = Number(match?.[2]); guard(Number.isSafeInteger(size) && size <= maximumBytes);
  const start = end + 1, finish = start + size;
  guard(finish < bytes.length && bytes[finish] === 10);
  const blob = bytes.subarray(start,finish);
  // Verify the bytes against Git's actual object framing as well as identity.
  guard(createHash('sha1').update(`blob ${size}\0`).update(blob).digest('hex') === entry.object);
  hash.update(entry.path).update('\0').update(blob).update('\0'); cursor = finish + 1;
 }
 guard(cursor === bytes.length); return hash.digest('hex');
}
/** @param {string} repositoryRoot @param {string} commit */
export function batchedGitSourceFingerprint(repositoryRoot, commit) {
 guard(/^[a-f0-9]{40}$/.test(commit));
 /** @param {string[]} args @param {string|undefined} input */
 const git = (args,input=undefined) => execFileSync('git',args,{cwd:repositoryRoot,input,windowsHide:true,
  stdio:['pipe','pipe','pipe'],timeout:15000,maxBuffer:maximumBytes});
 const tree = git(['ls-tree','-rz',commit]);
 /** @type {Map<string,string>} */ const blobs = new Map();
 try { for (const row of tree.toString('utf8').split('\0').filter(Boolean)) {
  const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(row); guard(match);
  const [,mode,type,object,path] = match ?? []; guard(typeof path === 'string');
  if (!roots.some(root => path === root || path?.startsWith(root + '/'))) continue;
  if (path === 'src/app/.well-known/workflow' || path.startsWith('src/app/.well-known/workflow/')) continue;
  guard(type === 'blob' && ['100644','100755'].includes(mode ?? '') && !blobs.has(path) && typeof object === 'string'); blobs.set(path,object);
 }} finally { tree.fill(0); }
 const expected = authoredGitTraversal([...blobs.keys()]).map(path => { const object = blobs.get(path); guard(object); return {path,object}; });
 guard(expected.length > 0 && expected.length <= 10000);
 const bytes = git(['cat-file','--batch'], expected.map(entry => entry.object).join('\n') + '\n');
 try { return fingerprintGitBatch(bytes,expected); } finally { bytes.fill(0); }
}
