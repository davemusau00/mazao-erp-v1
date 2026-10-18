import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { firefox } from '@playwright/test';

const baseURL = process.env.MAZAO_PERF_BASE_URL ?? 'http://127.0.0.1:55445';
const email = process.env.MAZAO_PERF_EMAIL;
const password = process.env.MAZAO_PERF_PASSWORD;
const outputDirectory = process.env.MAZAO_PERF_OUTPUT ?? 'docs/performance/evidence/before';
const extraApiPaths = (process.env.MAZAO_PERF_EXTRA_API_PATHS ?? '').split(/\r?\n/).map(path => path.trim()).filter(Boolean);
if (extraApiPaths.some(path => !path.startsWith('/api/v1/'))) throw new Error('Extra performance routes must be same-origin /api/v1 paths.');
if (!email || !password) throw new Error('Set MAZAO_PERF_EMAIL and MAZAO_PERF_PASSWORD for the disposable performance operator.');

function uuid(value) {
  const digest = createHash('md5').update(`mazao-performance:${value}`).digest('hex');
  const hex = `${digest.slice(0, 12)}4${digest.slice(13, 16)}${'89ab'[Number.parseInt(digest[16], 16) & 3]}${digest.slice(17)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function percentile(values, point) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * point) - 1)];
}

function summarize(samples) {
  const times = samples.map(sample => sample.totalMs).filter(Number.isFinite);
  return {
    sampleCount: samples.length,
    p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), p99ObservedMs: percentile(times, 0.99),
    responseBytesP95: percentile(samples.map(sample => sample.responseBytes).filter(Number.isFinite), 0.95),
    errorCount: samples.filter(sample => sample.status === null || sample.status < 200 || sample.status >= 400 || sample.outcome !== 'success').length,
  };
}

const browser = await firefox.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
const page = await context.newPage();
await page.addInitScript(() => {
  (window).__mazaoPerfEvents = [];
  for (const name of ['mazao:api-request-completed','mazao:api-request-failed','mazao:workspace-rendered','mazao:workspace-first-usable','mazao:workspace-render-cycle']) {
    window.addEventListener(name, event => (window).__mazaoPerfEvents.push({ name, detail: event.detail, at: performance.now() }));
  }
});

await mkdir(`${outputDirectory}/screenshots`, { recursive: true });
const launchAt = Date.now();
const navigation = [];
const screenshots = [];
const failedWorkspaces = [];
await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill(password);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page.getByLabel(/Signed in as Performance Operator/).waitFor({ timeout: 30_000 });

async function firstUsableCount(workspace) {
  return page.evaluate(id => (window).__mazaoPerfEvents.filter(event => event.name === 'mazao:workspace-first-usable' && event.detail.workspace === id).length, workspace);
}

async function clickWorkspace(id, label, captureScreenshot = true) {
  const button = page.locator('.workspace-nav').getByRole('button', { name: new RegExp(label) });
  if (await button.getAttribute('aria-current') === 'page') {
    const pivotId = id === 'help' ? 'today' : 'help';
    const pivotLabel = pivotId === 'help' ? 'Help' : 'Today';
    const pivot = page.locator('.workspace-nav').getByRole('button', { name: new RegExp(pivotLabel) });
    const pivotBefore = await firstUsableCount(pivotId);
    await pivot.click();
    await page.waitForFunction(({ id, before }) => (window).__mazaoPerfEvents.filter(event => event.name === 'mazao:workspace-first-usable' && event.detail.workspace === id).length > before, { id: pivotId, before: pivotBefore }, { timeout: 30_000 });
  }
  const before = await firstUsableCount(id);
  await button.click();
  await page.waitForFunction(({ id, before }) => (window).__mazaoPerfEvents.filter(event => event.name === 'mazao:workspace-first-usable' && event.detail.workspace === id).length > before, { id, before }, { timeout: 30_000 });
  const event = await page.evaluate(({ id, before }) => (window).__mazaoPerfEvents.filter(entry => entry.name === 'mazao:workspace-first-usable' && entry.detail.workspace === id)[before], { id, before });
  navigation.push({ workspace: id, durationMs: event.detail.durationMs, outcome: event.detail.outcome, blockingReadCount: event.detail.blockingReadCount });
  if (event.detail.outcome !== 'ready') failedWorkspaces.push(id);
  if (captureScreenshot) {
    const shotPath = `${outputDirectory}/screenshots/${id}-1280x800.png`;
    await page.screenshot({ path: shotPath, fullPage: false });
    screenshots.push(shotPath);
  }
}

// Capture ten navigation-to-first-usable samples for every implemented top-
// level workspace. Save one screenshot per workspace to keep the evidence set
// compact while retaining a meaningful within-run percentile sample.
const implementedWorkspaces = [
  ['today','Today'],['sell','Sell'],['sales','Sales history'],['stock','Stock'],['stock-count','Count stock'],
  ['purchasing','Purchasing'],['hotel','Hotel'],['reservations','Reservations'],['customers','Customers'],
  ['shifts','Shifts'],['money','Money'],['reports','Reports'],['manage','Manage'],['onboarding','Setup checklist'],['help','Help'],
];
for (const [id, label] of implementedWorkspaces) {
  for (let sample = 0; sample < 10; sample += 1) await clickWorkspace(id, label, sample === 0);
}

const manageTab = page.locator('.workspace-nav').getByRole('button', { name: 'Manage', exact: true });
await manageTab.click();
await page.getByRole('button', { name: /Business and outlets/ }).click();
await page.getByLabel('Business name', { exact: true }).waitFor({ timeout: 15_000 });
await page.screenshot({ path: `${outputDirectory}/screenshots/configuration-assets-1280x800.png`, fullPage: false });
await page.getByRole('button', { name: 'Staff', exact: true }).click();
await page.getByRole('heading', { name: 'Staff access' }).waitFor({ timeout: 15_000 });
await page.screenshot({ path: `${outputDirectory}/screenshots/staff-1280x800.png`, fullPage: false });
await page.getByRole('button', { name: 'Assignments', exact: true }).click();
await page.getByRole('heading', { name: /workspace assignment/i }).waitFor({ timeout: 15_000 }).catch(() => undefined);
await page.screenshot({ path: `${outputDirectory}/screenshots/assignments-1280x800.png`, fullPage: false });

const runtimeInfo = await page.evaluate(() => ({
  userAgent: navigator.userAgent,
  serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
  serviceWorkerState: navigator.serviceWorker?.controller?.state ?? 'not-controlled',
  navigation: performance.getEntriesByType('navigation').map(entry => ({ type: entry.type, durationMs: Math.round(entry.duration), domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd), loadMs: Math.round(entry.loadEventEnd) })),
  staticResources: performance.getEntriesByType('resource').filter(entry => new URL(entry.name).origin === location.origin && !new URL(entry.name).pathname.startsWith('/api/')).map(entry => ({ path: new URL(entry.name).pathname, durationMs: Math.round(entry.duration), transferBytes: entry.transferSize, decodedBytes: entry.decodedBodySize })),
}));
const resourceInfo = await page.evaluate(async () => {
  const configuration = await fetch('/api/v1/configuration', { credentials: 'include', cache: 'no-store' }).then(response => response.json());
  return { logo: configuration.configuration.business.logoUrl, qr: configuration.configuration.business.receiptQrImage };
});
resourceInfo.sampleOrderId = uuid('order:1');
const pngAssetChecks = await page.evaluate(async ({ logo, qr }) => {
  const inspect = async (name, source) => {
    let response;
    if (source.startsWith('data:image/png;base64,')) {
      const encoded = source.slice('data:image/png;base64,'.length);
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      response = new Response(new Blob([bytes], { type: 'image/png' }));
    } else response = await fetch(source, { credentials: 'include', cache: 'no-store' });
    const blob = await response.blob();
    const image = await createImageBitmap(blob);
    const result = { name, status: response.status, mediaType: blob.type, byteLength: blob.size, width: image.width, height: image.height };
    image.close();
    return result;
  };
  const replay = await fetch('/api/v1/configuration?legacy_inline_reproduction=1', { headers: { 'x-request-id': crypto.randomUUID() } }).then(response => response.json());
  return {
    activeAssets: await Promise.all([inspect('logo', logo), inspect('receipt_qr', qr)]),
    legacyReplayAssets: await Promise.all([inspect('legacy_logo', replay.configuration.business.logoUrl), inspect('legacy_receipt_qr', replay.configuration.business.receiptQrImage)]),
  };
}, resourceInfo);
const reactRenderSamples = await page.evaluate(() => (window).__mazaoPerfEvents.filter(event => event.name === 'mazao:workspace-render-cycle').map(event => event.detail));
const workspaceCommitSamples = await page.evaluate(() => (window).__mazaoPerfEvents.filter(event => event.name === 'mazao:workspace-rendered').map(event => ({ ...event.detail, observedAt: event.at })));
const reactRenderGroups = new Map();
for (const sample of reactRenderSamples) reactRenderGroups.set(sample.workspace, [...(reactRenderGroups.get(sample.workspace) ?? []), sample.durationMs]);
const reactRenderSummary = Object.fromEntries([...reactRenderGroups].map(([workspace, values]) => [workspace, { renderCount: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), maxMs: Math.max(...values) }]));
const workspaceFirstUsableSummary = Object.fromEntries(Object.entries(Object.groupBy(navigation, sample => sample.workspace)).map(([workspace, samples]) => {
  const times = samples.map(sample => sample.durationMs);
  return [workspace, { sampleCount: samples.length, p50Ms: percentile(times, 0.5), p95Ms: percentile(times, 0.95), maxMs: Math.max(...times), errorCount: samples.filter(sample => sample.outcome !== 'ready').length }];
}));

const runRouteSamples = async (paths, serialCount = 30, concurrentCount = 20) => page.evaluate(async ({ paths, serialCount, concurrentCount }) => {
  const read = async path => {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let headersAt = null; let bodyAt = null; let parseMs = 0; let responseBytes = null; let status = null; let outcome = 'network_error'; let requestId = crypto.randomUUID(); let serverTiming = '';
    try {
      const response = await fetch(path, { credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { 'x-request-id': requestId } });
      headersAt = performance.now(); status = response.status; requestId = response.headers.get('x-request-id') || requestId; serverTiming = response.headers.get('server-timing') || '';
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const text = await response.text(); bodyAt = performance.now(); responseBytes = new TextEncoder().encode(text).length;
        const parseStarted = performance.now(); try { JSON.parse(text); outcome = response.ok ? 'success' : 'http_error'; } catch { outcome = 'invalid_json'; } parseMs = performance.now() - parseStarted;
      } else {
        const body = await response.arrayBuffer(); bodyAt = performance.now(); responseBytes = body.byteLength; outcome = response.ok ? 'success' : 'http_error';
      }
    } catch (error) { outcome = error?.name === 'AbortError' ? 'timeout' : 'network_error'; }
    finally { clearTimeout(timer); }
    const totalMs = performance.now() - started;
    const duration = name => Number(new RegExp(`(?:^|,\\s*)${name};dur=(\\d+(?:\\.\\d+)?)`).exec(serverTiming)?.[1] ?? NaN);
    const queryCount = Number(/\bdbqueries;desc=(\d+)\b/.exec(serverTiming)?.[1] ?? NaN);
    const routeLabel = `${path.split('?', 1)[0]}${path.includes('legacy_inline_reproduction=1') ? '#legacy-inline-replay' : ''}`.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
    return { requestId, path: routeLabel, status, outcome, headersMs: headersAt === null ? null : headersAt - started, bodyMs: bodyAt === null || headersAt === null ? null : bodyAt - headersAt, parseMs, totalMs, responseBytes, serverAppMs: duration('app'), serverHandlerMs: duration('handler'), serverDbMs: duration('db'), serverDbPoolMs: duration('dbpool'), serverSerializationMs: duration('serialize'), serverNginxMs: duration('nginx'), serverDbQueryCount: queryCount };
  };
  const results = [];
  for (const path of paths) for (let index = 0; index < serialCount; index++) results.push({ mode: 'serial', ...(await read(path)) });
  for (const path of paths) {
    const samples = await Promise.all(Array.from({ length: concurrentCount }, () => read(path)));
    for (const sample of samples) results.push({ mode: 'concurrent', ...sample });
  }
  return results;
}, { paths, serialCount, concurrentCount });

const apiPaths = [
  '/api/v1/auth/me','/api/v1/auth/sessions','/api/v1/configuration','/api/v1/configuration?legacy_inline_reproduction=1',
  resourceInfo.logo,resourceInfo.qr,`/api/v1/sales/orders/${resourceInfo.sampleOrderId}/receipt/assets/logo`,`/api/v1/sales/orders/${resourceInfo.sampleOrderId}/receipt/assets/receipt_qr`,'/api/v1/catalog/items','/api/v1/inventory/movements',
  '/api/v1/inventory/counts','/api/v1/inventory/counts/current',`/api/v1/inventory/counts/${uuid('open-count')}`,
  '/api/v1/shifts/current','/api/v1/shifts/close-reports','/api/v1/sales/orders',
  `/api/v1/sales/orders/${uuid('order:1')}/receipt`,'/api/v1/customers',`/api/v1/customers/${uuid('customer:1')}/statement`,
  '/api/v1/staff','/api/v1/devices',`/api/v1/staff/${uuid('staff:1')}/sessions`,
  '/api/v1/catalog/imports','/api/v1/hospitality/rooms','/api/v1/hospitality/reservations','/api/v1/hospitality/stays',
  '/api/v1/reports/trial-balance?asOf=2026-10-17','/api/v1/reports/profit-loss?from=2026-01-01&to=2026-10-17',
  '/api/v1/reports/operational-analytics?from=2026-01-01&to=2026-10-17',
  '/api/v1/reports/journal-lines?accountCode=CASH_TILL&from=2026-01-01&to=2026-10-17&limit=100&offset=0',
  ...extraApiPaths,
];
const routeSamples = await runRouteSamples(apiPaths);
const routeSummary = Object.groupBy(routeSamples, sample => `${sample.path}|${sample.mode}`);
const routes = Object.fromEntries(Object.entries(routeSummary).map(([key, samples]) => [key, { ...summarize(samples), samples }]));

await mkdir(outputDirectory, { recursive: true });
const report = {
  runStartedAt: new Date(launchAt).toISOString(),
  environment: { browser: 'Firefox', runtime: runtimeInfo, baseURL, viewport: { width: 1280, height: 800 }, dataset: { products: 5000, orders: 5000, staff: 500, customers: 5000, movements: 40000, rooms: 300, reservations: 1200, maximumPngBytes: 524288 }, ingress: 'Pinned Bun API container -> local Nginx -> Firefox PWA; PostgreSQL 16 disposable local container' },
  workspaceFirstUsable: navigation,
  workspaceFirstUsableSummary,
  workspaceCommit: { timing: 'Navigation start to React layout-effect after workspace DOM commit; includes module loading and render work, not CPU-only.', samples: workspaceCommitSamples },
  workspaceReactRender: { method: 'First workspace render to React layout-effect after the active subtree commit; includes subtree reconciliation and DOM commit, not CPU-only component duration.', byWorkspace: reactRenderSummary, samples: reactRenderSamples },
  pngAssetChecks,
  workspaceErrors: failedWorkspaces,
  routeSummary: routes,
  screenshots,
  notes: ['No response bodies, cookies, credentials or tenant names are stored.', 'p99 is the largest observed sample in each 20-request burst, not a population guarantee.', 'Workspace render-cycle timing begins at the first active subtree render and ends at the React layout effect after DOM commit; it is not CPU-only component duration.', 'This report uses the isolated synthetic production-shaped fixture, not production business data.'],
};
await writeFile(`${outputDirectory}/firefox-performance.json`, JSON.stringify(report, null, 2));
await browser.close();
process.stdout.write(JSON.stringify({ output: `${outputDirectory}/firefox-performance.json`, workspaces: navigation.length, routes: Object.keys(routes).length, workspaceErrors: failedWorkspaces.length }) + '\n');
