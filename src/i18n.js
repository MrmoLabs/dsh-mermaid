const MESSAGES = {
  en: {
    viewOptions: 'Mermaid view options',
    diagramView: 'Diagram',
    codeView: 'Code',
    editView: 'Edit',
    editorLabel: 'Mermaid source editor',
    draftHint: 'Draft lives only in this page. Refreshing or rebuilding the card loses it.',
    reset: 'Reset',
    copySource: 'Copy',
    downloadMmd: 'Download .mmd',
    fullscreen: 'Fullscreen',
    downloadSvg: 'Download SVG',
    viewerLabel: 'Fullscreen Mermaid diagram viewer',
    viewerTitle: '{type} · Mermaid',
    zoomOut: 'Zoom out',
    resetZoom: 'Reset zoom to 100%',
    zoomIn: 'Zoom in',
    fitWindow: 'Fit to window',
    closeViewer: 'Close fullscreen viewer',
    rendering: 'Rendering diagram…',
    rendered: 'Mermaid diagram rendered.',
    renderFailed: 'Diagram rendering failed: {detail}',
    renderFailedStatus: 'Diagram rendering failed. Source code is shown.',
    tooLong: 'Diagram not rendered: source length {actual} characters exceeds the {limit} character limit.',
    tooManyLines: 'Diagram not rendered: source has {actual} lines and exceeds the {limit} line limit.',
    diagramTitle: 'Mermaid {type} diagram',
    downloaded: 'SVG downloaded.',
    downloadedMmd: '.mmd file downloaded.',
    copied: 'Source copied.',
    copyFailed: 'Copy failed; select the source and copy it manually.',
    previewUpdating: 'Updating preview… the last successful diagram is still shown.',
    previewStale: 'Preview not updated: {detail}',
    previewStaleStatus: 'Preview not updated. The last successful diagram is still shown.',
    emptyDraft: 'Source is empty; the preview was not updated.',
    draftReset: 'Draft reset to the message source.',
  },
  'zh-CN': {
    viewOptions: 'Mermaid 视图选项',
    diagramView: '图形',
    codeView: '代码',
    editView: '编辑',
    editorLabel: 'Mermaid 源码编辑器',
    draftHint: '草稿仅保存在当前页面；刷新或卡片重建后会丢失。',
    reset: '重置',
    copySource: '复制',
    downloadMmd: '下载 .mmd',
    fullscreen: '全屏',
    downloadSvg: '下载 SVG',
    viewerLabel: 'Mermaid 图全屏查看',
    viewerTitle: '{type} · Mermaid',
    zoomOut: '缩小',
    resetZoom: '恢复到 100%',
    zoomIn: '放大',
    fitWindow: '适应窗口',
    closeViewer: '关闭全屏查看',
    rendering: '正在渲染图表…',
    rendered: 'Mermaid 图已渲染。',
    renderFailed: '图表渲染失败：{detail}',
    renderFailedStatus: '图表渲染失败，已显示源代码。',
    tooLong: '图表未渲染：源码长度为 {actual} 字符，超过 {limit} 字符限制。',
    tooManyLines: '图表未渲染：源码共 {actual} 行，超过 {limit} 行限制。',
    diagramTitle: 'Mermaid {type} 图',
    downloaded: 'SVG 已下载。',
    downloadedMmd: '.mmd 文件已下载。',
    copied: '源码已复制。',
    copyFailed: '复制失败，请手动选择源码后复制。',
    previewUpdating: '正在更新预览…暂时保留上次成功的图。',
    previewStale: '预览未更新：{detail}',
    previewStaleStatus: '预览未更新，仍显示上次成功的图。',
    emptyDraft: '源码为空，预览尚未更新。',
    draftReset: '草稿已恢复为消息中的源码。',
  },
};

function normalizeLocale(value) {
  const locale = String(value || '').trim().toLowerCase();
  return locale === 'zh' || locale.startsWith('zh-') ? 'zh-CN' : 'en';
}

function resolveLocale(documentLocale, navigatorLocales = []) {
  const candidates = [documentLocale, ...navigatorLocales].filter(Boolean);
  return normalizeLocale(candidates[0]);
}

function translate(locale, key, parameters = {}) {
  const dictionary = MESSAGES[normalizeLocale(locale)] || MESSAGES.en;
  const template = dictionary[key] || MESSAGES.en[key] || key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : match
  ));
}

export { normalizeLocale, resolveLocale, translate };
