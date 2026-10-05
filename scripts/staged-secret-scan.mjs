#!/usr/bin/env node
// Portable copy of the environment's staged-secret-scan contract.
// Scan immutable blobs from the selected index, never the unstaged working tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIFF_ARGS = ['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '--diff-filter=ACMTU', '-z', '--'];
const MAX_BUFFER = 64 * 1024 * 1024;
const failure = reason => ({ code: 2, reason });
const pathKey = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, windowsHide: true, maxBuffer: MAX_BUFFER, timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error('git');
  return result.stdout;
}

function stagedEntries(raw) {
  const fields = new TextDecoder('utf-8', { fatal: true }).decode(raw).split('\0');
  if (fields.pop() !== '') throw new Error('index');
  const entries = [];
  for (let i = 0; i < fields.length; i += 2) {
    const metadata = /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([ACMTU])$/.exec(fields[i]);
    if (!metadata || !fields[i + 1] || metadata[5] === 'U' || /^0+$/.test(metadata[4])) throw new Error('index');
    // A gitlink records a commit ID, not a file blob; its contents are not committed here.
    if (metadata[2] !== '160000') entries.push({ name: fields[i + 1], oid: metadata[4] });
  }
  return entries;
}

function containedFile(directory, name) {
  const target = path.resolve(directory, name);
  if (!target.startsWith(directory + path.sep)) throw new Error('path');
  return target;
}

function scanResults(stdout, names) {
  const detections = [];
  for (const line of stdout.toString('utf8').split(/\r?\n/).filter(line => line.trim())) {
    const record = JSON.parse(line);
    if (!record || typeof record.DetectorName !== 'string' || !record.DetectorName) throw new Error('output');
    const reported = record.SourceMetadata?.Data?.Filesystem?.file;
    const stagedName = typeof reported === 'string' ? names.get(pathKey(reported)) : null;
    // Never echo Raw, Redacted, stderr, or an unrecognized path supplied by the scanner.
    detections.push({ file: stagedName ?? null });
  }
  return detections;
}

export function scanStaged({ repo = process.cwd(), scanner, scannerPrefixArgs = [], timeoutMs = 120000,
  downloads = path.join(os.homedir(), 'Downloads') } = {}) {
  let snapshot;
  let result;
  try {
    repo = git(repo, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
    const executable = process.platform === 'win32' ? 'trufflehog.exe' : 'trufflehog';
    scanner ??= process.env.TRUFFLEHOG_PATH || [
      path.resolve(repo, '../../tools/trufflehog-bin', executable),
      ...(process.env.PATH ?? '').split(path.delimiter).map(directory => path.join(directory, executable)),
    ].find(candidate => { try { return fs.statSync(candidate).isFile(); } catch { return false; } });
    if (!scanner) return failure('scanner-missing');
    try { if (!fs.statSync(scanner).isFile()) return failure('scanner-missing'); }
    catch { return failure('scanner-missing'); }
    const staged = git(repo, DIFF_ARGS);
    if (!staged.length) return { code: 0, scanned: 0 };
    const entries = stagedEntries(staged);
    if (!entries.length) return { code: 0, scanned: 0 };
    fs.mkdirSync(downloads, { recursive: true });
    downloads = fs.realpathSync(downloads);
    snapshot = fs.mkdtempSync(path.join(downloads, 'staged-secret-scan-'));
    const names = new Map();
    for (const entry of entries) {
      const file = containedFile(snapshot, entry.name);
      const normalized = pathKey(file);
      if (names.has(normalized)) throw new Error('path');
      names.set(normalized, entry.name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, git(repo, ['cat-file', 'blob', entry.oid]), { flag: 'wx', mode: 0o600 });
    }
    const scanned = spawnSync(scanner, [...scannerPrefixArgs, 'filesystem', '--results=verified,unknown,unverified',
      '--no-update', '--no-verification', '--fail', '--json', snapshot], {
      windowsHide: true, maxBuffer: MAX_BUFFER, timeout: timeoutMs,
    });
    if (scanned.error || scanned.signal || ![0, 183].includes(scanned.status)) {
      result = failure(scanned.error?.code === 'ETIMEDOUT' ? 'scanner-timeout' : 'scanner-failed');
    } else {
      let detections;
      try { detections = scanResults(scanned.stdout, names); }
      catch { result = failure('scanner-output'); }
      if (!result) {
        if (scanned.status === 183 && !detections.length) result = failure('scanner-output');
        else if (detections.length) result = { code: 1, findings: detections.length,
          files: [...new Set(detections.map(hit => hit.file).filter(Boolean))] };
        else result = { code: 0, scanned: entries.length };
      }
    }
    // Any index change invalidates this approval; the next commit must scan again.
    if (!git(repo, DIFF_ARGS).equals(staged)) result = failure('index-changed');
  } catch (error) {
    result = failure(['git', 'index', 'path'].includes(error.message) ? error.message : 'snapshot');
  } finally {
    if (snapshot) {
      try {
        // Delete only the unique snapshot this invocation created, after verifying its location.
        if (path.dirname(fs.realpathSync(snapshot)) !== downloads || !path.basename(snapshot).startsWith('staged-secret-scan-')) {
          throw new Error('cleanup');
        }
        fs.rmSync(snapshot, { recursive: true });
      } catch { result = failure('cleanup'); }
    }
  }
  return result;
}

export function formatResult(result) {
  if (result.code === 0) return `[secret-scan] OK: ${result.scanned} archivo(s) staged escaneado(s).`;
  if (result.code === 1) return `[secret-scan] COMMIT BLOQUEADO: ${result.findings} posible(s) secreto(s).\n` +
    result.files.slice(0, 20).map(file => `  Archivo staged: ${JSON.stringify(file)}`).join('\n');
  const messages = {
    'scanner-missing': 'Falta el ejecutable de TruffleHog. No se escaneó el índice.',
    'scanner-timeout': 'TruffleHog excedió el tiempo máximo. El escaneo quedó incompleto.',
    'scanner-failed': 'TruffleHog no terminó correctamente. El escaneo quedó incompleto.',
    'scanner-output': 'TruffleHog devolvió una salida inválida o incompleta.',
    'index-changed': 'El índice cambió durante el escaneo. Ejecuta el commit de nuevo.',
    git: 'No fue posible leer Git o un blob staged.',
    index: 'El índice no se pudo interpretar o tiene conflictos sin resolver.',
    path: 'Una ruta staged no pudo materializarse de forma segura.',
    snapshot: 'No fue posible materializar los archivos staged.',
    cleanup: 'No fue posible limpiar el snapshot temporal propio en Downloads.',
  };
  return `[secret-scan] COMMIT BLOQUEADO: ${messages[result.reason] ?? 'El escaneo no se completó.'}`;
}

function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!['--repo', '--scanner', '--timeout-ms'].includes(args[i]) || !args[i + 1]) {
      process.stderr.write('Uso: node tools/staged-secret-scan.mjs [--repo PATH] [--scanner PATH] [--timeout-ms N]\n');
      process.exitCode = 2;
      return;
    }
    options[{ '--repo': 'repo', '--scanner': 'scanner', '--timeout-ms': 'timeoutMs' }[args[i]]] = args[i + 1];
  }
  if (options.timeoutMs !== undefined) {
    options.timeoutMs = Number(options.timeoutMs);
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
      process.stderr.write('[secret-scan] COMMIT BLOQUEADO: timeout inválido.\n');
      process.exitCode = 2;
      return;
    }
  }
  const result = scanStaged(options);
  process.stderr.write(formatResult(result) + '\n');
  process.exitCode = result.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
