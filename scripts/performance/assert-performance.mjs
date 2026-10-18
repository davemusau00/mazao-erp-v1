import { readFile, writeFile } from 'node:fs/promises';

const evidencePath = process.env.MAZAO_PERF_EVIDENCE ?? 'docs/performance/evidence/after-2026-10-18/firefox-performance.json';
const outputPath = process.env.MAZAO_PERF_ASSERTION ?? 'docs/performance/evidence/after-2026-10-18/performance-assertion.json';
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const failures = [];
const apiP95LimitMs = 1500;
const workspaceP95LimitMs = 3000;
const expectedWorkspaceSamples = evidence.workspaceSampleMethod?.sampleCountPerWorkspace ?? 10;
const routeResults = [];

for (const [key, summary] of Object.entries(evidence.routeSummary ?? {})) {
  const [route, mode] = key.split('|');
  const routeMultiplier = route.includes('/api/v1/configuration/assets/') ? 2 : 1;
  if (mode === 'serial' && summary.sampleCount !== 30 * routeMultiplier) failures.push(`${route} serial sample count was ${summary.sampleCount}, expected ${30 * routeMultiplier}`);
  if (mode === 'concurrent' && summary.sampleCount !== 20 * routeMultiplier) failures.push(`${route} concurrent sample count was ${20 * routeMultiplier}`);
  if (route.includes('#legacy-inline-replay') || route.includes('/configuration/assets/') || route.includes('/receipt/assets/')) continue;
  const withinLimit = typeof summary.p95Ms === 'number' && summary.p95Ms <= apiP95LimitMs;
  routeResults.push({ route, mode, sampleCount: summary.sampleCount, p95Ms: summary.p95Ms, responseBytesP95: summary.responseBytesP95, errorCount: summary.errorCount, withinLimit });
  if (!withinLimit) failures.push(`${route} ${mode} p95 ${summary.p95Ms} ms exceeded ${apiP95LimitMs} ms or was missing`);
  if (summary.errorCount !== 0) failures.push(`${route} ${mode} had ${summary.errorCount} failed reads`);
}

for (const [workspace, summary] of Object.entries(evidence.workspaceFirstUsableSummary ?? {})) {
  if (summary.sampleCount !== expectedWorkspaceSamples) failures.push(`${workspace} workspace sample count was ${summary.sampleCount}, expected ${expectedWorkspaceSamples}`);
  if (typeof summary.p95Ms !== 'number' || summary.p95Ms > workspaceP95LimitMs) failures.push(`${workspace} first usable p95 ${summary.p95Ms} ms exceeded ${workspaceP95LimitMs} ms or was missing`);
  if (summary.errorCount !== 0) failures.push(`${workspace} had ${summary.errorCount} non-ready workspace outcomes`);
}

if (Object.keys(evidence.workspaceFirstUsableSummary ?? {}).length !== 15) failures.push('Expected all 15 implemented top-level workspaces in first-usable evidence');
if (!evidence.pngAssetChecks?.activeAssets?.every(asset => asset.status === 200 && asset.width > 0 && asset.height > 0)) failures.push('One or more current configuration PNG assets failed browser decode');
if (!evidence.pngAssetChecks?.legacyReplayAssets?.every(asset => asset.status === 200 && asset.width > 0 && asset.height > 0)) failures.push('One or more legacy replay PNGs failed browser decode');

const result = {
  checkedAt: new Date().toISOString(), evidencePath,
  scope: 'LATENCY_ONLY', releaseAcceptance: false,
  thresholds: { commonApiReadP95Ms: apiP95LimitMs, firstUsableWorkspaceP95Ms: workspaceP95LimitMs, serialSamplesPerRoute: 30, concurrentSamplesPerRoute: 20, samplesPerWorkspace: expectedWorkspaceSamples },
  routeResults,
  workspaceResults: evidence.workspaceFirstUsableSummary ?? {},
  failures,
  status: failures.length === 0 ? 'PASS' : 'FAIL',
  notes: ['This assertion checks latency samples only; it is not the full release acceptance decision. See docs/44-PERFORMANCE-ACCEPTANCE-2026-10-18.md for data completeness, browser coverage, CI, workload and restore gates.', 'The 20-request concurrent p95 is a local synthetic workload observation from one operator. It is not a production traffic guarantee.', 'Image endpoints and the legacy inline replay are measured and reported but are excluded from the common JSON API-read threshold.'],
};
await writeFile(outputPath, JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify({ output: outputPath, status: result.status, failureCount: failures.length }) + '\n');
if (failures.length) process.exitCode = 1;
