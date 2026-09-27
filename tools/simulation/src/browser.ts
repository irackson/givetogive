import { chromium, type Browser } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Semaphore } from './semaphore.ts';
import type { AgentCredentials } from './protocol.ts';
import { protectionHeaders } from './protection.ts';

export function safeBrowsePath(path: string, origin: string): URL {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Browser paths must be relative to staging.');
  const url = new URL(path, origin);
  if (url.origin !== new URL(origin).origin || !/^\/(?:asks(?:\/[^/]+)?|members(?:\/[^/]+)?|funds(?:\/[^/]+)?|giving|support)?$/.test(url.pathname))
    throw new Error('Browser path is outside the member navigation allowlist.');
  return url;
}
export function sessionUserId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('user' in value)) return undefined;
  const user = value.user;
  if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string') return undefined;
  return user.id;
}
export class BrowserPool {
  readonly slots: Semaphore;
  private browser?: Browser;
  private opening?: Promise<Browser>;
  private origin: string;
  private stateDirectory: string;
  private bypass?: string;
  constructor(origin: string, stateDirectory: string, concurrency: number, bypass?: string) {
    this.origin = origin; this.stateDirectory = stateDirectory; this.slots = new Semaphore(concurrency);
    this.bypass = bypass;
  }
  async browse(credentials: AgentCredentials, path: string, correlationId: string) {
    const url = safeBrowsePath(path, this.origin);
    return this.slots.run(async () => {
      this.opening ??= chromium.launch({ headless: true });
      this.browser = await this.opening;
      const storagePath = credentials.storageStatePath ?? join(this.stateDirectory, `browser-${credentials.id}.json`);
      const context = await this.browser.newContext({ storageState: existsSync(storagePath) ? storagePath : undefined, viewport: { width: 1280, height: 900 } });
      const errors: string[] = [];
      try {
        await context.route('**/*', async (route) => {
          const request = route.request();
          // No arbitrary navigation or credentials sent to third-party origins.
          if (request.isNavigationRequest() && new URL(request.url()).origin !== new URL(this.origin).origin) await route.abort();
          else await route.continue({ headers: { ...request.headers(), ...(new URL(request.url()).origin === new URL(this.origin).origin ? protectionHeaders(this.bypass) : {}) } });
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message.slice(0, 300)));
        page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)); });
        await page.goto(new URL('/api/auth/session', this.origin).href);
        const sessionText = await page.locator('body').innerText();
        const currentSession: unknown = JSON.parse(sessionText);
        if (sessionUserId(currentSession) !== credentials.userId) {
          if (!credentials.email || !credentials.password) throw new Error('No valid browser session or fixture login credentials.');
          await context.clearCookies();
          await page.goto(new URL('/signin', this.origin).href);
          await page.getByLabel('Email').fill(credentials.email);
          await page.getByLabel('Password').fill(credentials.password);
          await page.getByRole('button', { name: 'Sign in', exact: true }).click();
          await page.waitForURL((target) => target.pathname !== '/signin', { timeout: 20000 });
          const session = await context.request.get(new URL('/api/auth/session', this.origin).href, { headers: protectionHeaders(this.bypass), maxRedirects: 0 });
          const identity: unknown = await session.json();
          if (sessionUserId(identity) !== credentials.userId) throw new Error('Browser account identity mismatch.');
          mkdirSync(this.stateDirectory, { recursive: true });
          await context.storageState({ path: storagePath });
        }
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.locator('main').waitFor({ timeout: 15000 });
        if (url.pathname === '/asks') {
          await page.getByRole('form', { name: 'Filter Asks' }).waitFor({ timeout: 15000 });
          await page.getByText('Loading the noticeboard…', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 });
        }
        const text = (await page.locator('main').innerText()).slice(0, 4500);
        const screenshot = join(this.stateDirectory, 'screenshots', `${credentials.id}-${correlationId}.png`);
        mkdirSync(join(this.stateDirectory, 'screenshots'), { recursive: true });
        await page.screenshot({ path: screenshot });
        if (errors.length) throw new Error(`Browser errors: ${errors.join('; ').slice(0, 700)}`);
        return { path: url.pathname, title: await page.title(), errors, screenshot, text };
      } finally { await context.close(); }
    });
  }
  async close() { await this.browser?.close(); }
}
