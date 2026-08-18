import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('release version stays synchronized across package, runtime, lockfile, and changelog', async () => {
  const [packageSource, lockSource, runtimeSource, changelog] = await Promise.all([
    read('package.json'),
    read('package-lock.json'),
    read('version.js'),
    read('CHANGELOG.md'),
  ]);
  const packageJson = JSON.parse(packageSource);
  const packageLock = JSON.parse(lockSource);

  assert.equal(packageJson.version, '0.1.0');
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.match(runtimeSource, new RegExp(`version: ["']${packageJson.version.replaceAll('.', '\\.')}`));
  assert.match(runtimeSource, /releasedAt: ["']2026-08-18["']/);
  assert.match(changelog, new RegExp(`## \\[${packageJson.version.replaceAll('.', '\\.') }\\] - 2026-08-18`));
});
