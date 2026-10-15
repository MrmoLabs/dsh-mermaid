const MESSAGES = {
  en: {
    usage: `Usage:
  dsh-mermaid install [--profile web|desktop] [--source <package-spec>]
  dsh-mermaid uninstall [--profile web|desktop]

Examples:
  npx -y github:MrmoLabs/dsh-mermaid install
  dsh-mermaid install --profile desktop
  dsh-mermaid install --source .

Set DSH_MERMAID_LANG=en or zh-CN to choose the installer language.`,
    missingValue: '{option} requires a value',
    unsafeWindowsArgument: '{label} contains characters unsupported by the Windows command line',
    installArgument: 'Installation argument',
    dshNotFound: 'Cannot find dsh. Install DeepSeek Harness and ensure dsh is on PATH.',
    dshExit: 'dsh exited with status {status}',
    unknownArguments: 'Unrecognized arguments: {arguments}',
    unknownCommand: 'Unrecognized command: {command}',
    installed: '\ndsh-mermaid installed. Restart {target}, then open a conversation containing a Mermaid code block.',
    uninstalled: '\ndsh-mermaid uninstalled. Restart {target}.',
    webTarget: 'dsh web',
    desktopTarget: 'DSH Desktop',
    otherTarget: 'DSH for the {profile} profile',
  },
  'zh-CN': {
    usage: `用法：
  dsh-mermaid install [--profile web|desktop] [--source <包规格>]
  dsh-mermaid uninstall [--profile web|desktop]

示例：
  npx -y github:MrmoLabs/dsh-mermaid install
  dsh-mermaid install --profile desktop
  dsh-mermaid install --source .

设置 DSH_MERMAID_LANG=en 或 zh-CN 可指定安装器语言。`,
    missingValue: '{option} 需要一个值',
    unsafeWindowsArgument: '{label} 包含 Windows 命令行不支持的字符',
    installArgument: '安装参数',
    dshNotFound: '找不到 dsh，请先安装 DeepSeek Harness 并确保 dsh 在 PATH 中。',
    dshExit: 'dsh 退出，状态码 {status}',
    unknownArguments: '无法识别的参数：{arguments}',
    unknownCommand: '无法识别的命令：{command}',
    installed: '\ndsh-mermaid 已安装。请重启 {target}，然后打开一个包含 Mermaid 代码块的会话。',
    uninstalled: '\ndsh-mermaid 已卸载。请重启 {target}。',
    webTarget: 'dsh web',
    desktopTarget: 'DSH Desktop',
    otherTarget: '{profile} profile 对应的 DSH',
  },
};

function normalizeLocale(value) {
  const locale = String(value || '').split(':', 1)[0].split(/[.@]/, 1)[0].trim().replaceAll('_', '-').toLowerCase();
  return locale === 'zh' || locale.startsWith('zh-') ? 'zh-CN' : 'en';
}

function isNeutralLocale(value) {
  const locale = String(value || '').split(':', 1)[0].split(/[.@]/, 1)[0].trim().toLowerCase();
  return locale === 'c' || locale === 'posix';
}

function resolveLocale(env = process.env, systemLocale = Intl.DateTimeFormat().resolvedOptions().locale) {
  const value = [
    env.DSH_MERMAID_LANG,
    env.DSH_LANG,
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
    env.LANGUAGE,
    systemLocale,
  ].find((candidate) => String(candidate || '').trim() && !isNeutralLocale(candidate));
  return normalizeLocale(value);
}

function translate(locale, key, parameters = {}) {
  const template = MESSAGES[normalizeLocale(locale)][key];
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : match
  ));
}

export { normalizeLocale, resolveLocale, translate };
