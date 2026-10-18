import { readFile, writeFile } from 'node:fs/promises';
import { firefox } from '@playwright/test';

const baseURL = process.env.MAZAO_PERF_BASE_URL ?? 'http://127.0.0.1:55445';
const email = process.env.MAZAO_PERF_EMAIL;
const password = process.env.MAZAO_PERF_PASSWORD;
const evidencePath = process.env.MAZAO_PERF_EVIDENCE;
const outputPath = process.env.MAZAO_WORKSPACE_OUTPUT;
const sampleCount = Number(process.env.MAZAO_WORKSPACE_SAMPLE_COUNT ?? 50);
if (!email || !password || !evidencePath || !outputPath || !Number.isInteger(sampleCount) || sampleCount < 10) {
  throw new Error('Set disposable performance credentials, evidence/output paths and a workspace sample count of at least 10.');
}

const percentile = (values, point) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * point) - 1)] ?? null;
};
const workspaces = [
  ['today', 'Today'], ['sell', 'Sell'], ['sales', 'Sales history'], ['stock', 'Stock'], ['stock-count', 'Count stock'],
  ['purchasing', 'Purchasing'], ['hotel', 'Hotel'], ['reservations', 'Reservations'], ['customers', 'Customers'],
  ['shifts', 'Shifts'], ['money', 'Money'], ['reports', 'Reports'], ['manage', 'Manage'], ['onboarding', 'Setup checklist'], ['help', 'Help'],
];

const browser = await firefox.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__workspaceMatrix = [];
  window.addEventListener('mazao:workspace-first-usable', event => window.__workspaceMatrix.push({ ...event.detail, at: performance.now() }));
});
await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByLabel(/Signed in as Performance Operator/).waitFor({ timeout: 30_000 });

const samples = [];
async function waitForWorkspaceEvent(id, previousCount) {
  await page.waitForFunction(({ id, previousCount }) => window.__workspaceMatrix.filter(event => event.workspace === id).length > previousCount, { id, previousCount }, { timeout: 30_000 });
  return page.evaluate(({ id, previousCount }) => window.__workspaceMatrix.filter(event => event.workspace === id)[previousCount], { id, previousCount });
}
async function select(id, label) {
  const button = page.locator('.workspace-nav').getByRole('button', { name: new RegExp(label) });
  if (await button.getAttribute('aria-current') === 'page') {
    const pivotId = id === 'help' ? 'today' : 'help';
    const pivotLabel = pivotId === 'help' ? 'Help' : 'Today';
    const pivot = page.locator('.workspace-nav').getByRole('button', { name: new RegExp(pivotLabel) });
    const previousCount = await page.evaluate(workspace => window.__workspaceMatrix.filter(event => event.workspace === workspace).length, pivotId);
    await pivot.click();
    await waitForWorkspaceEvent(pivotId, previousCount);
  }
  const previousCount = await page.evaluate(workspace => window.__workspaceMatrix.filter(event => event.workspace === workspace).length, id);
  await button.click();
  return waitForWorkspaceEvent(id, previousCount);
}

const runStartedAt = new Date().toISOString();
for (const [id, label] of workspaces) {
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const event = await select(id, label);
    samples.push({ workspace: id, sample: sample + 1, durationMs: event.durationMs, outcome: event.outcome, blockingReadCount: event.blockingReadCount, observedAtMs: event.at });
  }
}

const groups = Object.groupBy(samples, sample => sample.workspace);
const summary = Object.fromEntries(Object.entries(groups).map(([workspace, group]) => {
  const durations = group.map(sample => sample.durationMs);
  return [workspace, { sampleCount: group.length, p50Ms: percentile(durations, 0.5), p95Ms: percentile(durations, 0.95), p99ObservedMs: percentile(durations, 0.99), maxMs: Math.max(...durations), errorCount: group.filter(sample => sample.outcome !== 'ready').length }];
}));
const runtime = await page.evaluate(() => ({ userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller), serviceWorkerState: navigator.serviceWorker?.controller?.state ?? 'not-controlled' }));
await writeFile(outputPath, JSON.stringify({ runStartedAt, browser: 'Firefox', runtime, sampleCountPerWorkspace: sampleCount, samples, summary }, null, 2));

const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
evidence.workspaceFirstUsable = samples;
evidence.workspaceFirstUsableSummary = summary;
evidence.workspaceSampleMethod = { sampleCountPerWorkspace: sampleCount, evidencePath: outputPath, browser: runtime.userAgent, viewport: runtime.viewport, serviceWorkerState: runtime.serviceWorkerState };
await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
await browser.close();
process.stdout.write(JSON.stringify({ output: outputPath, evidencePath, workspaces: samples.length, errors: samples.filter(sample => sample.outcome !== 'ready').length }) + '\n');
