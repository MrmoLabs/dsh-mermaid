#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { resolveLocale, translate } from './locale.mjs';

const PACKAGE_NAME = 'dsh-mermaid';
const DEFAULT_SOURCE = 'github:MrmoLabs/dsh-mermaid';
const locale = resolveLocale();
const t = (key, parameters) => translate(locale, key, parameters);

function usage() {
  console.log(t('usage'));
}

function takeOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(t('missingValue', { option: name }));
  args.splice(index, 2);
  return value;
}

function normalizeSource(requested) {
  if (requested === '.' || requested === '..' || requested.startsWith('./') || requested.startsWith('../')) {
    return resolve(process.cwd(), requested);
  }
  return isAbsolute(requested) ? requested : requested;
}

function assertSafeWindowsArgument(value, label) {
  if (process.platform === 'win32' && /[&|<>^%!()\r\n"]/.test(value)) {
    throw new Error(t('unsafeWindowsArgument', { label }));
  }
}

function hasWindowsDsh() {
  const directories = [process.cwd(), ...(process.env.PATH || '').split(delimiter)];
  return directories.some((entry) => {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    return directory && existsSync(join(directory, 'dsh.cmd'));
  });
}

function runDsh(args) {
  const executable = process.platform === 'win32' ? 'dsh.cmd' : 'dsh';
  for (const argument of args) assertSafeWindowsArgument(argument, t('installArgument'));
  if (process.platform === 'win32' && !hasWindowsDsh()) throw new Error(t('dshNotFound'));
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error?.code === 'ENOENT') {
    throw new Error(t('dshNotFound'));
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(t('dshExit', { status: result.status ?? 1 }));
}

function restartTarget(profile) {
  if (profile === 'web') return t('webTarget');
  if (profile === 'desktop') return t('desktopTarget');
  return t('otherTarget', { profile });
}

const args = process.argv.slice(2);
const command = args.shift();

if (!command || command === '--help' || command === '-h') {
  usage();
  process.exit(0);
}

try {
  const profile = takeOption(args, '--profile', 'web');
  assertSafeWindowsArgument(profile, '--profile');

  if (command === 'install') {
    const source = normalizeSource(takeOption(args, '--source', DEFAULT_SOURCE));
    if (args.length) throw new Error(t('unknownArguments', { arguments: args.join(' ') }));
    runDsh(['plugin', '--profile', profile, 'add', '-w', '--save-exact', source]);
    console.log(t('installed', { target: restartTarget(profile) }));
  } else if (command === 'uninstall') {
    if (args.length) throw new Error(t('unknownArguments', { arguments: args.join(' ') }));
    runDsh(['plugin', '--profile', profile, 'remove', '-w', PACKAGE_NAME]);
    console.log(t('uninstalled', { target: restartTarget(profile) }));
  } else {
    throw new Error(t('unknownCommand', { command }));
  }
} catch (error) {
  console.error(`dsh-mermaid: ${error.message}`);
  process.exit(1);
}
