import { createSettingsModel, createSettingsScope } from './settings-model.js';
import { MERMAID_SETTINGS_SAVED } from './settings-event.js';
import { PREVIEW_CSS, createSettingsPreview } from './settings-preview.js';

const COPY = {
  en: {
    title: 'Rendering style', theme: 'Color theme', look: 'Drawing style',
    auto: 'Follow DSH', default: 'Default', dark: 'Dark', neutral: 'Neutral', forest: 'Forest', base: 'Custom', classic: 'Standard', handDrawn: 'Hand-drawn',
    lookHint: 'Some diagram types may show little difference with the hand-drawn style.',
    previewTitle: 'Style preview', previewMode: 'Preview brightness', previewDiagram: 'Sample review workflow',
    previewSource: 'flowchart LR\n  A([Request]) --> B{Review}\n  B -->|Yes| C[Approve]\n  B -.->|Edit| D[Revise]',
    previewLoading: 'Rendering preview…', previewInvalid: 'Fix the configuration errors to update the preview.',
    previewFailed: 'The preview could not be rendered.', previewRetry: 'Retry preview',
    custom: 'Custom colors and font', common: 'Common', light: 'Light', advanced: 'Advanced variables (JSON)',
    primaryColor: 'Base color', mainBkg: 'Node fill', primaryTextColor: 'Node text', primaryBorderColor: 'Node border', lineColor: 'Lines', fontFamily: 'Font family', fontSize: 'Font size',
    inherited: 'Use Mermaid default', example: 'Load Indigo / Slate example', defaults: 'Restore defaults', discard: 'Discard changes',
    stagedHint: 'The example and defaults replace only this draft. Save to apply them to your profile.',
    inactive: 'Custom variables are retained. Select Custom to edit and use them.',
    jsonHint: 'Paste a plain JSON object. Additional Mermaid variables, nested groups and arrays are supported; unknown variables may be ignored by Mermaid.',
    invalidJson: 'Invalid JSON. Check double quotes, commas and closing brackets.', invalid: 'Invalid configuration',
    unavailable: 'Settings are unavailable on this host. You can still edit the profile configuration file.', readOnly: 'This connection cannot save profile settings.',
    save: 'Save', saving: 'Saving…', saveFailed: 'Save failed. Your draft is retained; check permissions or configuration conflicts.',
    clean: 'Saved settings', dirty: 'Unsaved changes', saved: 'Saved. Open diagrams update automatically.', failed: 'Save failed; draft retained.',
    applyHint: 'Settings belong to the current DSH profile. Per-diagram frontmatter can override these defaults. ZenUML follows the palette brightness and has its own colors.',
    conflict: 'The host configuration changed while you were editing. Your draft is retained. Discard changes to load the latest values before editing again.',
    storedInvalid: 'The saved configuration is invalid. Its fields and variables have been retained; fix the errors and save, or explicitly restore defaults.',
    original: 'Original saved configuration (read-only)', invalidSaved: 'Invalid saved value — select a replacement', profileRepair: 'This structure cannot be repaired with the regular fields. Keep a copy of the original JSON and fix the profile file, or explicitly restore defaults.',
    fillOverride: 'Node fill is set separately by mainBkg. Change Node fill to update flowcharts; changing Base color does not overwrite that setting. Other diagram types may use their own variables.',
    inheritedCommon: 'Inherited common value: ',
    advancedInvalid: 'Fix the JSON for this group before using its color and font fields.',
    pick: 'Pick', fieldHint: 'Leave a field empty to inherit common variables or Mermaid defaults. Picking a color adds an override to this group.',
    INVALID_VARIABLES: 'Use a plain JSON object for this group.', INVALID_VALUE: 'Use strings, booleans, finite numbers, arrays or plain objects; null is not allowed.', UNSAFE_KEY: 'Prototype-related keys are not allowed.', MAX_DEPTH: 'Variable groups may be at most 8 levels deep.', MAX_ITEMS: 'The three groups may contain at most 2,048 properties or elements.', MAX_STRING: 'Each string may contain at most 8,192 characters.', MAX_BYTES: 'The complete configuration may be at most 64 KiB of UTF-8 JSON.',
  },
  'zh-CN': {
    title: '渲染风格', theme: '配色主题', look: '绘图风格',
    auto: '跟随 DSH', default: '默认', dark: '深色', neutral: '中性', forest: '森林', base: '自定义', classic: '标准', handDrawn: '手绘',
    lookHint: '部分图表类型的手绘效果可能不明显。',
    previewTitle: '效果预览', previewMode: '预览明暗模式', previewDiagram: '审核流程示例图',
    previewSource: 'flowchart LR\n  A([提交]) --> B{审核}\n  B -->|通过| C[批准]\n  B -.->|退回| D[修改]',
    previewLoading: '正在绘制预览…', previewInvalid: '修正配置错误后即可更新预览。',
    previewFailed: '无法绘制预览。', previewRetry: '重试预览',
    custom: '自定义颜色与字体', common: '公共', light: '浅色', advanced: '高级变量（JSON）',
    primaryColor: '基础主色', mainBkg: '节点填充', primaryTextColor: '节点文字', primaryBorderColor: '节点边框', lineColor: '连线', fontFamily: '字体', fontSize: '字号',
    inherited: '使用 Mermaid 默认值', example: '载入 Indigo / Slate 示例', defaults: '恢复默认', discard: '放弃更改',
    stagedHint: '载入示例和恢复默认只替换当前草稿；点击保存后才写入当前 profile。',
    inactive: '自定义变量已保留；选择“自定义”后可编辑并使用。',
    jsonHint: '粘贴普通 JSON 对象，支持更多 Mermaid 变量、嵌套分组和数组；未知变量可能被 Mermaid 忽略。',
    invalidJson: 'JSON 格式有误，请检查双引号、逗号和括号是否闭合。', invalid: '配置无效',
    unavailable: '当前宿主暂不支持此设置表单，仍可编辑 profile 配置文件。', readOnly: '当前连接没有保存 profile 设置的权限。',
    save: '保存', saving: '正在保存…', saveFailed: '保存失败，草稿已保留；请检查权限或配置冲突。',
    clean: '已保存的设置', dirty: '有未保存的更改', saved: '已保存，已打开的图表会自动更新。', failed: '保存失败，草稿已保留。',
    applyHint: '设置保存在当前 DSH profile 中，单图 frontmatter 可以覆盖默认设置。ZenUML 随配色明暗切换，图内使用独立颜色。',
    conflict: '编辑期间宿主配置发生了变化，草稿已保留。请先放弃更改以读取最新配置，再重新编辑。',
    storedInvalid: '已保存的配置无效，原有字段与变量已保留；请修复错误后保存，或明确恢复默认。',
    original: '已保存的原始配置（只读）', invalidSaved: '已保存的值无效，请重新选择', profileRepair: '此结构无法通过常规字段修复。请保留原始 JSON 并修复 profile 文件，或明确恢复默认。',
    fillOverride: '节点填充由 mainBkg 单独指定。要改变流程图的填充，请修改“节点填充”；“基础主色”不会覆盖它。其他图表类型可能使用各自的变量。',
    inheritedCommon: '继承公共值：',
    advancedInvalid: '请先修正本组 JSON，再使用颜色和字体输入框。',
    pick: '取色', fieldHint: '留空继承公共变量或 Mermaid 默认值；取色会为当前组添加覆盖值。',
    INVALID_VARIABLES: '本组必须使用普通 JSON 对象。', INVALID_VALUE: '仅支持字符串、布尔值、有限数字、数组和普通对象，不允许 null。', UNSAFE_KEY: '不允许使用原型相关键。', MAX_DEPTH: '每组变量最多嵌套 8 层。', MAX_ITEMS: '三组变量合计不能超过 2,048 个属性或元素。', MAX_STRING: '单个字符串不能超过 8,192 个字符。', MAX_BYTES: '整份配置的 UTF-8 JSON 不能超过 64 KiB。',
  },
};
const CSS = `.dsh-mmd-settings{color:var(--dsw-alias-label-primary,inherit);font-family:inherit}.dsh-mmd-settings h3{font-size:16px;font-weight:600;margin:0 0 20px}.dsh-mmd-settings label{display:block;font-size:14px;margin-bottom:6px}.dsh-mmd-settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:16px;margin-bottom:16px}.dsh-mmd-settings select,.dsh-mmd-settings textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,#888);border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit}.dsh-mmd-settings select:focus-visible,.dsh-mmd-settings textarea:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4c6ef5);outline-offset:2px}.dsh-mmd-settings select option{background:var(--dsw-alias-bg-layer-1,Canvas);color:var(--dsw-alias-label-primary,CanvasText)}.dsh-mmd-settings p:not(.dsh-mmd-settings-preview-canvas *){font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,inherit);margin:8px 0 16px}.dsh-mmd-settings-actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 8px}.dsh-mmd-settings-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.dsh-mmd-settings-tabs button[aria-selected=true]{outline:2px solid var(--dsw-alias-button-primary-fill,#4c6ef5);outline-offset:1px}.dsh-mmd-settings textarea{min-height:240px;resize:vertical;font:13px/1.6 var(--ds-font-family-code,ui-monospace,monospace);tab-size:2}.dsh-mmd-settings [role=alert]{color:var(--dsw-alias-state-error-primary,#d33);overflow-wrap:anywhere}.dsh-mmd-settings summary{cursor:pointer;font-size:14px;margin:16px 0}.dsh-mmd-settings fieldset{border:0;padding:0;margin:0;min-width:0}.dsh-mmd-settings fieldset:disabled{opacity:.6}.dsh-mmd-settings-colors input{width:100%;box-sizing:border-box}.dsh-mmd-settings-color{display:flex;gap:8px;align-items:center}.dsh-mmd-settings-color input[type=color]{width:38px;height:36px;padding:2px;flex:none;border:1px solid var(--dsw-alias-border-l1,#888);background:transparent;border-radius:6px}`;

const PICKER_CSS = `.dsh-mmd-settings-picker{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;flex:none;width:38px;height:36px;border:1px solid var(--dsw-alias-border-l1,#888);border-radius:6px;font-size:11px}.dsh-mmd-settings-picker:focus-within{outline:2px solid var(--dsw-alias-button-primary-fill,#4c6ef5);outline-offset:2px}.dsh-mmd-settings-color .dsh-mmd-settings-picker input[type=color]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;padding:0;border:0}`;

function createSettingsPage({ React, primitives, model, locale }) {
  const h = React.createElement;
  const { SettingsForm, Button, Input } = primitives;
  const SettingsPreview = createSettingsPreview(React, Button);
  return function SettingsPage() {
    const state = React.useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
    const language = React.useSyncExternalStore((listener) => locale.subscribe(listener), () => locale.getSnapshot().active);
    const t = (key) => (COPY[/^zh\b/i.test(language) ? 'zh-CN' : 'en'][key] || key);
    const [group, setGroup] = React.useState('common');
    const [previewMode, setPreviewMode] = React.useState(null);
    const [advancedOpen, setAdvancedOpen] = React.useState(false);
    const id = React.useId().replaceAll(':', '');
    const disabled = !state.writable;
    const fieldsDisabled = disabled || state.blockedStructure;
    const active = state.draft.theme === 'base';
    const selectGroup = (value) => {
      setGroup(value);
      if (active && value !== 'common') setPreviewMode(value);
    };
    let variables;
    try { const value = JSON.parse(state.draft.groups[group].trim() || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) variables = value; } catch { /* Show the JSON diagnostic below. */ }
    let common;
    try { const value = JSON.parse(state.draft.groups.common.trim() || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) common = value; } catch { /* Keep the current group's editor usable. */ }
    const inherited = (key) => group !== 'common' && typeof common?.[key] === 'string' ? common[key] : undefined;
    const effectiveFill = variables && Object.hasOwn(variables, 'mainBkg') ? variables.mainBkg : inherited('mainBkg');
    const errors = state.diagnostics;
    const errorList = errors.length ? h('div', { role: 'alert', id: `${id}-errors` }, errors.map((error, i) => h('p', { key: i }, `${error.path || t('title')}: ${error.code === 'INVALID_JSON' ? t('invalidJson') : `${t(error.code) === error.code ? t('invalid') : t(error.code)} (${error.code})`}`))) : null;
    const selector = (field, options) => h('div', { key: field },
      h('label', { htmlFor: `${id}-${field}` }, t(field)),
      h('select', { id: `${id}-${field}`, value: options.includes(state.draft[field]) ? state.draft[field] : '__invalid__', disabled: fieldsDisabled, onChange: (event) => model.edit(field, event.target.value) },
        !options.includes(state.draft[field]) ? h('option', { value: '__invalid__', disabled: true }, t('invalidSaved')) : null,
        options.map((value) => h('option', { key: value, value }, t(value)))));
    const button = (label, onClick, extra = {}) => h(Button, { variant: 'outline', size: 'sm', type: 'button', disabled, onClick, ...extra }, t(label));
    const field = (key, color) => {
      const colorValue = variables && Object.hasOwn(variables, key) ? variables[key] : inherited(key);
      const hex = typeof colorValue === 'string' && /^#[0-9a-f]{6}$/i.test(colorValue) ? colorValue : null;
      return h('div', { key }, h('label', { htmlFor: `${id}-${group}-${key}` }, t(key)),
        h('div', { className: 'dsh-mmd-settings-color' }, color ? h('span', { className: 'dsh-mmd-settings-picker', style: hex ? { backgroundColor: hex } : undefined }, hex ? null : h('span', { 'aria-hidden': true }, t('pick')),
          h('input', { type: 'color', value: hex || '#808080', disabled: fieldsDisabled || !active || !variables, 'aria-label': `${t(group)} ${t(key)} ${t('pick')}`, onChange: (event) => model.editVariable(group, key, event.target.value) })) : null,
          h(Input, { id: `${id}-${group}-${key}`, value: typeof variables?.[key] === 'string' ? variables[key] : '', placeholder: inherited(key) !== undefined ? t('inheritedCommon') + inherited(key) : t('inherited'), disabled: fieldsDisabled || !active || !variables, onChange: (event) => model.editVariable(group, key, event.target.value) })));
    };
    return h('section', { className: 'dsh-mmd-settings', 'aria-label': t('title') }, h('style', null, CSS + PICKER_CSS + PREVIEW_CSS),
      h(SettingsForm, { labels: { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }, state: { ...state, invalid: state.invalid || state.conflict }, onSave: async () => {
        if (await model.save()) window.dispatchEvent(new Event(MERMAID_SETTINGS_SAVED));
      }, onDiscard: () => {} },
        h('h3', null, t('title')),
        h('div', { className: 'dsh-mmd-settings-intro' },
          h('div', null,
            h('div', { className: 'dsh-mmd-settings-grid' }, selector('theme', ['auto', 'default', 'dark', 'neutral', 'forest', 'base']), selector('look', ['classic', 'handDrawn'])),
            h('p', null, t('lookHint')),
            h('div', { className: 'dsh-mmd-settings-actions' }, button('example', model.indigo), button('defaults', model.defaults), button('discard', model.discard, { disabled: state.saving || !state.dirty })),
            h('p', null, t('stagedHint'))),
          state.available ? h(SettingsPreview, {
            draftStyle: state.draftStyle, canCompare: active || state.draft.theme === 'auto', mode: previewMode, setMode: setPreviewMode, t,
          }) : null),
        state.storedInvalid ? h('p', { role: 'alert' }, t('storedInvalid')) : null,
        state.originalJSON ? h('details', null, h('summary', null, t('original')), h('textarea', { 'aria-label': t('original'), readOnly: true, value: state.originalJSON, spellCheck: false })) : null,
        state.needsProfileRepair ? h('p', { role: 'alert' }, t('profileRepair')) : null,
        h('details', { open: active || errors.length > 0 }, h('summary', null, t('custom')),
          !active ? h('p', null, t('inactive')) : null,
          h('div', { className: 'dsh-mmd-settings-tabs', role: 'tablist', 'aria-label': t('custom') }, ['common', 'light', 'dark'].map((value, index, all) => h(Button, {
            key: value, variant: 'outline', size: 'sm', type: 'button', role: 'tab', id: `${id}-tab-${value}`, 'aria-selected': group === value, 'aria-controls': `${id}-panel`, tabIndex: group === value ? 0 : -1,
            onClick: () => selectGroup(value), onKeyDown: (event) => {
              const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1;
              if (next < 0) return; event.preventDefault(); selectGroup(all[next]); document.getElementById(`${id}-tab-${all[next]}`)?.focus();
            },
          }, t(value)))),
          h('div', { id: `${id}-panel`, role: 'tabpanel', 'aria-labelledby': `${id}-tab-${group}` },
            h('fieldset', { disabled: fieldsDisabled || !active },
              h('div', { className: 'dsh-mmd-settings-grid dsh-mmd-settings-colors' }, ...(group === 'common' ? ['fontFamily', 'fontSize'].map((key) => field(key, false)) : ['primaryColor', 'mainBkg', 'primaryTextColor', 'primaryBorderColor', 'lineColor'].map((key) => field(key, true)))),
              group !== 'common' && typeof effectiveFill === 'string' && effectiveFill.trim() ? h('p', null, t('fillOverride')) : null,
              h('p', null, t('fieldHint')),
              !variables ? h('p', null, t('advancedInvalid')) : null,
              h('details', { open: advancedOpen || errors.some((error) => error.path.startsWith(`themeVariables.${group}`)), onToggle: (event) => setAdvancedOpen(event.currentTarget.open) }, h('summary', null, t('advanced')),
                h('label', { htmlFor: `${id}-json` }, `${t(group)} JSON`),
                h('textarea', { id: `${id}-json`, value: state.draft.groups[group], spellCheck: false, placeholder: '{}', 'aria-invalid': errors.some((error) => error.path.startsWith(`themeVariables.${group}`)), 'aria-describedby': errors.length ? `${id}-errors` : undefined, onChange: (event) => model.editGroup(group, event.target.value) }),
                h('p', null, t('jsonHint')))))),
        errorList,
        state.conflict ? h('p', { role: 'alert' }, t('conflict')) : null,
        h('p', { role: 'status', 'aria-live': 'polite' }, t(state.status)),
        h('p', null, t('applyHint'))));
  };
}

function registerSettingsRuntime({ ctx, React, primitives }) {
  const model = createSettingsModel(createSettingsScope(ctx.configForms));
  const Page = createSettingsPage({ React, primitives, model, locale: ctx.locale });
  const beforeUnload = (event) => { if (model.getSnapshot().dirty || model.getSnapshot().saving) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return { Page, dispose() { window.removeEventListener('beforeunload', beforeUnload); model.dispose(); } };
}

export { COPY, createSettingsPage, registerSettingsRuntime };
