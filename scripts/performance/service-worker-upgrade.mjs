import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium, firefox } from '@playwright/test';

const baseURL = process.env.MAZAO_PERF_BASE_URL ?? 'http://127.0.0.1:55445';
const email = process.env.MAZAO_PERF_EMAIL;
const password = process.env.MAZAO_PERF_PASSWORD;
const outputDirectory = process.env.MAZAO_SW_UPGRADE_OUTPUT ?? 'docs/performance/evidence/browser-reliability';
if (!email || !password) throw new Error('Set MAZAO_PERF_EMAIL and MAZAO_PERF_PASSWORD for the disposable performance operator.');

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const serviceWorkerPath = resolve(repositoryRoot, 'dist/sw.js');
const originalServiceWorker = await readFile(serviceWorkerPath);
const marker = `mazao-perf-sw-${randomUUID()}`;
const probeCode = `\nself.addEventListener('message',event=>{if(event.data===${JSON.stringify(marker)})event.ports[0]?.postMessage(${JSON.stringify(marker)})});\n`;
let browser;
let context;
let serviceWorkerModified = false;
const results = [];
const failures = [];

try {
  await writeFile(serviceWorkerPath, Buffer.concat([originalServiceWorker, Buffer.from(probeCode)]));
  serviceWorkerModified = true;
  for (const [browserName, engine] of [['Firefox', firefox], ['Chromium', chromium]]) {
    browser = await engine.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel(/Signed in as Performance Operator/).waitFor({ timeout: 30_000 });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });

    const sentinelId = randomUUID();
    await page.evaluate(async id => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('mazao-v1-import-validations', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('operations', { keyPath: 'commandId' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('operations', 'readwrite');
          transaction.objectStore('operations').put({ commandId: id, type: 'catalog.import.validate', tenantId: 'pwa-upgrade-test', deviceId: 'pwa-upgrade-test', actorId: 'pwa-upgrade-test', fileName: 'upgrade-sentinel.csv', sourceHash: 'b'.repeat(64), state: 'outcome_unknown', savedAt: new Date().toISOString() });
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onabort = () => { database.close(); reject(transaction.error); };
        };
      });
    }, sentinelId);

    const updateStarted = Date.now();
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('No service-worker registration exists.');
      await registration.update();
    });
    const activatedHandle = await page.waitForFunction(async markerValue => {
      const controller = navigator.serviceWorker.controller;
      if (!controller) return false;
      return await new Promise(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 800);
        channel.port1.onmessage = event => {
          clearTimeout(timer); channel.port1.close(); resolve(event.data === markerValue);
        };
        controller.postMessage(markerValue, [channel.port2]);
      });
    }, marker, { timeout: 45_000 });
    const activated = await activatedHandle.jsonValue();
    const updateMs = Date.now() - updateStarted;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByLabel(/Signed in as Performance Operator/).waitFor({ timeout: 30_000 });
    const preservedRecord = await page.evaluate(async id => new Promise((resolve, reject) => {
      const request = indexedDB.open('mazao-v1-import-validations', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('operations', 'readonly');
        const get = transaction.objectStore('operations').get(id);
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => reject(get.error);
        transaction.oncomplete = () => database.close();
      };
    }), sentinelId);
    await page.evaluate(async id => new Promise((resolve, reject) => {
      const request = indexedDB.open('mazao-v1-import-validations', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('operations', 'readwrite');
        transaction.objectStore('operations').delete(id);
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onabort = () => { database.close(); reject(transaction.error); };
      };
    }), sentinelId);
    const result = { browser: browserName, browserVersion: browser.version(), serviceWorkerUpdateActivated: activated, updateMs, recoveryRecordPreserved: preservedRecord?.commandId === sentinelId, recoverySentinelRemoved: true };
    results.push(result);
    if (!result.serviceWorkerUpdateActivated || !result.recoveryRecordPreserved) failures.push(`${browserName}: update activation or IndexedDB preservation failed`);
    await context.close(); context = undefined;
    await browser.close(); browser = undefined;
  }
} catch (error) {
  failures.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  if (context) await context.close().catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  if (serviceWorkerModified) await writeFile(serviceWorkerPath, originalServiceWorker);
}

const report = {
  runAt: new Date().toISOString(), baseURL, results, failures,
  notes: [
    'This disposable upgrade probe appends a test-only message handler to the generated service-worker script, forces a browser update and verifies a synthetic import-recovery metadata row remains in IndexedDB.',
    'The original generated service-worker file is restored byte-for-byte after the probe. The synthetic row is removed from each isolated browser context; no financial command is sent or replayed.',
  ],
};
await writeFile(`${outputDirectory}/service-worker-upgrade.json`, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ output: `${outputDirectory}/service-worker-upgrade.json`, browsers: results.length, failures: failures.length }) + '\n');
if (failures.length) process.exitCode = 1;
