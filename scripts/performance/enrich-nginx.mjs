import { readFile, writeFile } from 'node:fs/promises';

const evidencePath = process.env.MAZAO_PERF_EVIDENCE;
const nginxLogPath = process.env.MAZAO_NGINX_LOG;
if (!evidencePath || !nginxLogPath) throw new Error('Set MAZAO_PERF_EVIDENCE and MAZAO_NGINX_LOG.');

const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
const nginxLog = await readFile(nginxLogPath, 'utf8');
const byRequestId = new Map();
for (const line of nginxLog.split(/\r?\n/)) {
  const fields = Object.fromEntries([...line.matchAll(/([a-z_]+)=([^\s]+)/g)].map(([, key, value]) => [key, value]));
  if (!fields.request_id || fields.request_id === '-') continue;
  byRequestId.set(fields.request_id, {
    nginxTotalMs: Number(fields.total_seconds) * 1000,
    nginxUpstreamMs: fields.upstream_seconds === '-' ? null : Number(fields.upstream_seconds.split(',')[0]) * 1000,
    wireBytes: Number(fields.response_bytes),
    nginxStatus: Number(fields.status),
  });
}

const percentile = (values, point) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * point) - 1)] : null;
};
const metrics = ['headersMs', 'bodyMs', 'parseMs', 'serverAppMs', 'serverHandlerMs', 'serverDbMs', 'serverDbPoolMs', 'serverSerializationMs', 'nginxTotalMs', 'nginxUpstreamMs', 'responseBytes', 'wireBytes'];
let matched = 0;
let unmatched = 0;
const all = [];
for (const summary of Object.values(evidence.routeSummary ?? {})) {
  for (const sample of summary.samples ?? []) {
    const ingress = byRequestId.get(sample.requestId);
    if (ingress) {
      Object.assign(sample, ingress);
      matched += 1;
    } else unmatched += 1;
    all.push(sample);
  }
}
const summarize = samples => Object.fromEntries(metrics.map(metric => {
  const values = samples.map(sample => sample[metric]);
  return [metric, { p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99Observed: percentile(values, 0.99) }];
}));

evidence.ingress = {
  kind: 'Nginx access log correlated by request ID',
  logPath: nginxLogPath,
  sampleCount: all.length,
  requestIdMatched: matched,
  requestIdUnmatched: unmatched,
  totals: summarize(all),
};
for (const summary of Object.values(evidence.routeSummary ?? {})) summary.timingSummary = summarize(summary.samples ?? []);
await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
process.stdout.write(JSON.stringify({ evidencePath, requestIdMatched: matched, requestIdUnmatched: unmatched, sampleCount: all.length }) + '\n');
