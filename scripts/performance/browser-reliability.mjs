import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox } from '@playwright/test';

const baseURL = process.env.MAZAO_PERF_BASE_URL ?? 'http://127.0.0.1:55445';
const email = process.env.MAZAO_PERF_EMAIL;
const password = process.env.MAZAO_PERF_PASSWORD;
const outputDirectory = process.env.MAZAO_RELIABILITY_OUTPUT ?? 'docs/performance/evidence/browser-reliability';
if (!email || !password) throw new Error('Set MAZAO_PERF_EMAIL and MAZAO_PERF_PASSWORD for the disposable performance operator.');

const cases = [];
const failures = [];
const engines = [['Firefox', firefox], ['Chromium', chromium]];
const viewports = [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]];
await mkdir(`${outputDirectory}/screenshots`, { recursive: true });

async function seedRecoverySentinel(page) {
  return page.evaluate(async () => {
    const commandId = crypto.randomUUID();
    const record = {
      commandId,
      type: 'catalog.import.validate',
      tenantId: 'pwa-upgrade-test-tenant',
      deviceId: 'pwa-upgrade-test-device',
      actorId: 'pwa-upgrade-test-operator',
      fileName: 'pwa-recovery-preservation-sentinel.csv',
      sourceHash: 'a'.repeat(64),
      state: 'outcome_unknown',
      savedAt: new Date().toISOString(),
    };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('mazao-v1-import-validations', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('operations', { keyPath: 'commandId' });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('operations', 'readwrite');
        tx.objectStore('operations').put(record);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
    return record;
  });
}

async function readRecoverySentinel(page, commandId, remove = false) {
  return page.evaluate(async ({ commandId, remove }) => new Promise((resolve, reject) => {
    const request = indexedDB.open('mazao-v1-import-validations', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('operations', remove ? 'readwrite' : 'readonly');
      const store = tx.objectStore('operations');
      let record;
      if (remove) store.delete(commandId);
      else {
        const get = store.get(commandId);
        get.onsuccess = () => { record = get.result ?? null; };
        get.onerror = () => reject(get.error);
      }
      tx.oncomplete = () => { db.close(); resolve(record ?? null); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), { commandId, remove });
}

for (const [engineName, engine] of engines) {
  let browser;
  try {
    browser = await engine.launch({ headless: true });
  } catch (error) {
    failures.push(`${engineName} browser launch: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  for (const [viewportName, viewport] of viewports) {
    const result = { engine: engineName, viewport: viewportName, viewportSize: viewport, checks: {} };
    let context;
    try {
      context = await browser.newContext({ viewport, serviceWorkers: 'allow' });
      const page = await context.newPage();
      await page.addInitScript(() => {
        (window).__reliabilityEvents = [];
        for (const name of ['mazao:workspace-first-usable', 'mazao:api-request-failed']) {
          window.addEventListener(name, event => (window).__reliabilityEvents.push({ name, detail: event.detail, at: performance.now() }));
        }
      });
      const started = Date.now();
      await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByLabel(/Signed in as Performance Operator/).waitFor({ timeout: 30_000 });
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      });
      result.checks.coldStartMs = Date.now() - started;
      result.checks.serviceWorkerControlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
      result.checks.serviceWorkerState = await page.evaluate(() => navigator.serviceWorker.controller?.state ?? 'not-controlled');
      const sentinel = await seedRecoverySentinel(page);
      result.checks.recoverySentinelSeeded = sentinel.commandId;
      const stem = `${engineName.toLowerCase()}-${viewportName}`;
      await page.screenshot({ path: `${outputDirectory}/screenshots/${stem}-ready.png`, fullPage: false });

      const refreshStarted = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByLabel(/Signed in as Performance Operator/).waitFor({ timeout: 30_000 });
      result.checks.warmRefreshMs = Date.now() - refreshStarted;
      result.checks.recoveryAfterWarmRefresh = await readRecoverySentinel(page, sentinel.commandId);

      const stockButton = viewport.width < 600
        ? page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Stock', exact: true })
        : page.locator('.workspace-nav').getByRole('button', { name: 'Stock', exact: true });
      const beforeFailures = await page.evaluate(() => (window).__reliabilityEvents.filter(event => event.name === 'mazao:api-request-failed').length);
      await context.setOffline(true);
      await stockButton.click();
      await page.waitForFunction(before => (window).__reliabilityEvents.filter(event => event.name === 'mazao:api-request-failed').length > before, beforeFailures, { timeout: 15_000 });
      await page.getByText(/You are offline/i).first().waitFor({ timeout: 10_000 });
      await page.getByRole('alert').first().waitFor({ timeout: 10_000 });
      result.checks.offlineWorkspaceError = true;
      await page.screenshot({ path: `${outputDirectory}/screenshots/${stem}-offline-workspace.png`, fullPage: false });

      const offlineReloadStarted = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Server session could not be verified' }).waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Retry server check' }).waitFor({ timeout: 5_000 });
      result.checks.offlineRefreshMs = Date.now() - offlineReloadStarted;
      result.checks.recoveryAfterOfflineRefresh = await readRecoverySentinel(page, sentinel.commandId);
      await page.screenshot({ path: `${outputDirectory}/screenshots/${stem}-offline-refresh.png`, fullPage: false });

      await context.setOffline(false);
      const reconnectStarted = Date.now();
      await page.getByRole('button', { name: 'Retry server check' }).click();
      await page.getByLabel(/Signed in as Performance Operator/).waitFor({ timeout: 30_000 });
      result.checks.reconnectMs = Date.now() - reconnectStarted;
      const persistedSentinel = await readRecoverySentinel(page, sentinel.commandId);
      result.checks.recoveryAfterReconnect = persistedSentinel;
      await readRecoverySentinel(page, sentinel.commandId, true);
      result.checks.recoverySentinelRemovedAfterCheck = true;
      result.checks.outcome = result.checks.serviceWorkerControlled && result.checks.recoveryAfterWarmRefresh?.commandId === sentinel.commandId && result.checks.recoveryAfterOfflineRefresh?.commandId === sentinel.commandId && result.checks.recoveryAfterReconnect?.commandId === sentinel.commandId ? 'pass' : 'fail';
      if (result.checks.outcome !== 'pass') failures.push(`${engineName} ${viewportName}: a service worker or recovery persistence assertion failed`);
    } catch (error) {
      result.checks.outcome = 'fail';
      result.error = error instanceof Error ? error.message : String(error);
      failures.push(`${engineName} ${viewportName}: ${result.error}`);
    } finally {
      if (context) await context.close();
      cases.push(result);
    }
  }
  await browser.close();
}

const report = {
  runAt: new Date().toISOString(),
  baseURL,
  browsers: cases,
  failures,
  notes: [
    'Each run uses a fresh isolated Playwright browser context and synthetic performance operator.',
    'Offline refresh verifies the precached app shell and actionable session restore error; API records are not served from a stale cache.',
    'A synthetic import-validation recovery reference is checked across warm refresh, offline refresh, and reconnect, then removed from the isolated context.',
    'This run does not simulate a different service-worker script version; upgrade activation remains a separate release check.',
  ],
};
await writeFile(`${outputDirectory}/browser-reliability.json`, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ output: `${outputDirectory}/browser-reliability.json`, cases: cases.length, failures: failures.length }) + '\n');
if (failures.length) process.exitCode = 1;
