import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

test('the application entry graph excludes retired preview storage and simulated hardware', () => {
  const root = resolve(import.meta.dirname, '../../..');
  const pending = [resolve(root, 'src/main.tsx')];
  const seen = new Set<string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const name = relative(root, file).replaceAll('\\', '/');
    assert.notEqual(name, 'src/services/storage.ts', 'No eager or indirect browser financial storage import');
    assert.notEqual(name, 'src/services/hardware.ts', 'No simulated hardware import');
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /VITE_ALLOW_LOCAL_PREVIEW|new StorageEngine\s*\(/);
    const imports = [...source.matchAll(/(?:import(?!\s+type\b)[\s\S]*?from\s*|export[\s\S]*?from\s*)['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)];
    for (const match of imports) {
      const target = resolve(dirname(file), match[1] || match[2]);
      const candidate = [target, `${target}.tsx`, `${target}.ts`, `${target}.js`, resolve(target, 'index.tsx'), resolve(target, 'index.ts')].find(path => /\.[jt]sx?$/.test(path) && existsSync(path));
      if (candidate) pending.push(candidate);
    }
  }
  assert.ok(seen.size > 20, 'Traverse the real component and service dependency graph');
});
