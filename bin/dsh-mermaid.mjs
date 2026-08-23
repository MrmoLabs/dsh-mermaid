#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

const PACKAGE_NAME = 'dsh-mermaid';
const DEFAULT_SOURCE = 'github:MrmoLabs/dsh-mermaid';

function usage() {
  console.log(`Usage:
  dsh-mermaid install [--profile web] [--source <package-spec>]
  dsh-mermaid uninstall [--profile web]

Examples:
  npx -y github:MrmoLabs/dsh-mermaid install
  dsh-mermaid install --source dsh-mermaid
  dsh-mermaid install --source .`);
}

function takeOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
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
    throw new Error(`${label} 包含 Windows 命令行不支持的字符`);
  }
}

function runDsh(args) {
  const executable = process.platform === 'win32' ? 'dsh.cmd' : 'dsh';
  for (const argument of args) assertSafeWindowsArgument(argument, '安装参数');
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error?.code === 'ENOENT') {
    throw new Error('找不到 dsh，请先安装 DeepSeek Harness 并确保 dsh 在 PATH 中。');
  }
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`dsh 退出，状态码 ${result.status ?? 1}`);
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
    if (args.length) throw new Error(`无法识别的参数：${args.join(' ')}`);
    runDsh(['plugin', '--profile', profile, 'add', '-w', '--save-exact', source]);
    console.log('\ndsh-mermaid 已安装。请重启 dsh web，然后打开一个包含 Mermaid 代码块的会话。');
  } else if (command === 'uninstall') {
    if (args.length) throw new Error(`无法识别的参数：${args.join(' ')}`);
    runDsh(['plugin', '--profile', profile, 'remove', '-w', PACKAGE_NAME]);
    console.log('\ndsh-mermaid 已卸载。请重启 dsh web。');
  } else {
    throw new Error(`无法识别的命令：${command}`);
  }
} catch (error) {
  console.error(`dsh-mermaid: ${error.message}`);
  process.exit(1);
}
