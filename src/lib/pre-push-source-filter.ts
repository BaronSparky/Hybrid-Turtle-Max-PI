/**
 * DEPENDENCIES
 * Consumed by: .husky/pre-push, pre-push-source-filter.test.ts
 * Consumes: Node stdin/process only
 * Risk-sensitive: NO — developer workflow guard only
 * Notes: Decides whether changed files should trigger the local smoke test.
 */

import { pathToFileURL } from 'url';

const SOURCE_CHANGE_PATTERNS = [
  /^src\//,
  /^scripts\//,
  /^packages\//,
  /^services\//,
  /^tasks\//,
  /^prisma\//,
  /^\.husky\//,
  /^package(-lock)?\.json$/,
  /^tsconfig\.json$/,
  /^next\.config\.js$/,
  /^vitest\.config\.ts$/,
  /^eslint\.config\.mjs$/,
];

export function shouldRunSmokeForChangedFiles(changedFiles: string[]): boolean {
  if (changedFiles.length === 0) return true;

  return changedFiles.some((file) => {
    const normalized = file.trim().replace(/\\/g, '/');
    return SOURCE_CHANGE_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';

  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { resolve(data); });
    process.stdin.on('error', reject);
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const changedFiles = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  process.exit(shouldRunSmokeForChangedFiles(changedFiles) ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}