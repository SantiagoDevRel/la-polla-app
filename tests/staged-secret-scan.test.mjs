import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scanStaged } from '../scripts/staged-secret-scan.mjs';

const downloads = path.join(os.homedir(), 'Downloads');
fs.mkdirSync(downloads, { recursive: true });
const root = fs.mkdtempSync(path.join(downloads, 'la-polla-hook-test-'));
const git = (args, env = process.env) => {
  const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
git(['init', '--quiet']);
const alternate = path.join(root, 'selected.index');
const env = { ...process.env, GIT_INDEX_FILE: alternate };
git(['read-tree', '--empty'], env);
fs.writeFileSync(path.join(root, 'pick.txt'), 'STAGED');
git(['add', 'pick.txt'], env);
fs.writeFileSync(path.join(root, 'pick.txt'), 'UNSTAGED');
const fake = path.join(root, 'scanner.cjs');
const fakeSource = `const fs=require('fs'),path=require('path'); const dir=process.argv.at(-1); const value=fs.readFileSync(path.join(dir,'pick.txt'),'utf8'); if(value!=='STAGED')process.exit(9);`;
fs.writeFileSync(fake, fakeSource);
const options = { repo: root, scanner: process.execPath, scannerPrefixArgs: [fake], downloads };
const originalIndex = process.env.GIT_INDEX_FILE;
process.env.GIT_INDEX_FILE = alternate;
const indexBefore = fs.readFileSync(alternate);

test('scans selected staged blobs without reading unstaged edits or changing the index', () => {
  assert.equal(scanStaged(options).code, 0);
  assert.deepEqual(fs.readFileSync(alternate), indexBefore);
  const defaultEnvironment = { ...process.env };
  delete defaultEnvironment.GIT_INDEX_FILE;
  assert.equal(git(['diff', '--cached', '--name-only'], defaultEnvironment), '');
});
test('missing scanner, failed scanner, timeout and invalid output block', () => {
  assert.equal(scanStaged({ ...options, scanner: path.join(root, 'missing') }).code, 2);
  for (const source of ['process.exit(7)', 'console.log("not json")', 'process.exit(183)', 'setTimeout(()=>{},5000)']) {
    fs.writeFileSync(fake, source);
    assert.equal(scanStaged({ ...options, timeoutMs: 150 }).code, 2);
  }
});
test('scanner findings block without printing secret values', () => {
  fs.writeFileSync(fake, 'console.log(JSON.stringify({DetectorName:"Fixture",Raw:"never-print",SourceMetadata:{Data:{Filesystem:{file:process.argv.at(-1)+"/pick.txt"}}}}));process.exit(183)');
  const result = scanStaged(options);
  assert.equal(result.code, 1);
  assert.deepEqual(result.files, ['pick.txt']);
  assert.ok(!JSON.stringify(result).includes('never-print'));
});
test('real TruffleHog rejects a staged synthetic private key after the working copy is sanitized', () => {
  const scanner = process.env.TRUFFLEHOG_PATH ?? path.resolve('../../tools/trufflehog-bin/trufflehog.exe');
  if (!fs.existsSync(scanner)) throw new Error('Set TRUFFLEHOG_PATH to run the real secret gate regression.');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(root, 'fixture.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  git(['add', 'fixture.pem'], env);
  fs.writeFileSync(path.join(root, 'fixture.pem'), 'sanitized working copy');
  const before = fs.readFileSync(alternate);
  const result = scanStaged({ repo: root, scanner, downloads });
  assert.equal(result.code, 1);
  assert.ok(result.files.includes('fixture.pem'));
  assert.deepEqual(fs.readFileSync(alternate), before);
});
const sharedHook = process.env.SHARED_GIT_HOOK_PATH ?? path.resolve('../../tools/git-hooks-worktree/pre-commit');
test('the portable repo hook preserves the selected index and blocks its synthetic key', () => {
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(new URL('../scripts/staged-secret-scan.mjs', import.meta.url), path.join(root, 'scripts/staged-secret-scan.mjs'));
  const before = fs.readFileSync(alternate);
  const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh';
  const portableHook = new URL('../.githooks/pre-commit', import.meta.url);
  const selected = spawnSync(shell, [fileURLToPath(portableHook)], {
    cwd: root, env: { ...process.env, GIT_INDEX_FILE: alternate }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(selected.status, 1, selected.stderr);
  assert.ok(selected.stderr.includes('fixture.pem'));
  assert.ok(!selected.stderr.includes('BEGIN PRIVATE KEY'));
  assert.deepEqual(fs.readFileSync(alternate), before);
});
test('the shared worktree wrapper preserves the selected index and blocks its synthetic key', { skip: !fs.existsSync(sharedHook) }, () => {
  const before = fs.readFileSync(alternate);
  const shell = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'sh';
  const selected = spawnSync(shell, [sharedHook], { cwd: root, env: { ...process.env, GIT_INDEX_FILE: alternate }, encoding: 'utf8', windowsHide: true });
  assert.equal(selected.status, 1, selected.stderr);
  assert.ok(selected.stderr.includes('fixture.pem'));
  assert.ok(!selected.stderr.includes('BEGIN PRIVATE KEY'));
  assert.deepEqual(fs.readFileSync(alternate), before);
});
test.after(() => {
  if (originalIndex === undefined) delete process.env.GIT_INDEX_FILE;
  else process.env.GIT_INDEX_FILE = originalIndex;
  assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(downloads));
  fs.rmSync(root, { recursive: true });
});
