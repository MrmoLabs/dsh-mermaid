import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

test('renders localized accessible cards and recovers from errors', async () => {
  const harness = await createClientHarness();
  const { addCodeBlock, code, document, state, wait, window } = harness;
  try {
    await wait(1_100);
    const card = document.querySelector('.dsh-mmd');
    assert.ok(card, 'a Mermaid card should be inserted');
    assert.equal(card.dataset.state, 'ok');
    assert.equal(card.querySelector('.dsh-mmd-label'), null);
    assert.equal(card.querySelector('[role="status"]')?.textContent, 'Mermaid 图已渲染。');
    const svg = card.querySelector('.dsh-mmd-pane svg');
    assert.equal(svg?.getAttribute('role'), 'img');
    assert.equal(svg?.querySelector('title')?.textContent, 'Mermaid flowchart 图');
    assert.equal(svg?.getAttribute('aria-labelledby'), svg?.querySelector('title')?.id);

    const viewControls = card.querySelectorAll('.dsh-mmd-view-control');
    const [diagramButton, codeButton, editButton] = viewControls;
    assert.equal(diagramButton.parentElement.getAttribute('aria-label'), 'Mermaid 视图选项');
    assert.equal(codeButton.textContent, '代码');
    assert.equal(diagramButton.textContent, '图形');
    assert.equal(editButton.textContent, '编辑');
    codeButton.click();
    assert.equal(card.dataset.view, 'code');
    assert.equal(codeButton.getAttribute('aria-pressed'), 'true');
    assert.equal(card.querySelector('.dsh-mmd-code')?.textContent, 'flowchart LR\nA-->B');
    const [svgButton, fullscreenButton] = card.querySelectorAll('.dsh-mmd-diagram-action');
    const fileActions = card.querySelector('.dsh-mmd-file-actions');
    const exportMenu = fileActions.querySelector('.dsh-mmd-export-list');
    assert.equal(svgButton.parentElement, exportMenu);
    assert.equal(exportMenu.getAttribute('popover'), 'auto');
    assert.deepEqual([...exportMenu.children].map((button) => button.textContent), ['下载 SVG', '下载 PNG', '下载 PNG（主题背景）', '下载 .mmd']);
    assert.equal(svgButton.disabled, false);
    assert.equal(window.getComputedStyle(fullscreenButton.closest('.dsh-mmd-preview')).display, 'none');
    assert.equal(card.querySelector('.dsh-mmd-feedback').parentElement, card);
    diagramButton.click();
    assert.equal(card.dataset.view, 'diagram');
    assert.equal(diagramButton.getAttribute('aria-pressed'), 'true');
    assert.equal(fullscreenButton.parentElement.getAttribute('aria-label'), '图形查看工具');
    assert.equal(card.querySelector('.dsh-mmd-error-actions').hidden, true);

    editButton.click();
    assert.equal(card.dataset.view, 'edit');
    assert.equal(editButton.getAttribute('aria-pressed'), 'true');
    assert.equal(card.querySelector('.dsh-mmd-textarea')?.value, 'flowchart LR\nA-->B');
    assert.equal(window.getComputedStyle(card.querySelector('.dsh-mmd-editor')).display, 'flex');
    assert.notEqual(window.getComputedStyle(card.querySelector('.dsh-mmd-pane')).display, 'none');
    assert.equal(card.querySelector('.dsh-mmd-editor .dsh-mmd-panel-head').textContent, 'Mermaid 源码恢复原文');
    assert.equal(card.querySelector('.dsh-mmd-preview-label').textContent, '图形预览');

    document.documentElement.lang = 'en-US';
    await wait(10);
    assert.equal(card.querySelector('.dsh-mmd-label'), null);
    assert.equal(codeButton.textContent, 'Code');
    assert.equal(diagramButton.textContent, 'Diagram');
    assert.equal(editButton.textContent, 'Edit');
    assert.equal(svgButton.textContent, 'Download SVG');
    document.documentElement.lang = 'zh-CN';
    await wait(10);

    const invalid = addCodeBlock('flowchart LR\nA-->');
    await wait(1_100);
    const invalidCard = invalid.pre.previousElementSibling;
    assert.equal(invalidCard?.dataset.state, 'error');
    assert.equal(invalidCard?.dataset.view, 'diagram');
    assert.match(invalidCard?.querySelector('.dsh-mmd-error')?.textContent || '', /渲染失败/);
    assert.equal(invalidCard?.querySelector('.dsh-mmd-retry').hidden, true);
    assert.equal(invalidCard?.querySelector('.dsh-mmd-error-actions').hidden, false);
    assert.equal(invalidCard?.querySelector('[role="status"]')?.textContent, '图表渲染失败。可打开编辑检查源码。');
    const invalidViewControls = invalidCard?.querySelectorAll('.dsh-mmd-view-control') || [];
    assert.equal(invalidViewControls[0].hidden, false);
    assert.equal(invalidViewControls[1].hidden, false);
    assert.equal(invalidViewControls[2].hidden, false);
    invalidViewControls[2].click();
    assert.equal(invalidCard?.querySelector('.dsh-mmd-preview .dsh-mmd-error')?.parentElement.className, 'dsh-mmd-feedback');
    assert.equal(invalidCard?.querySelector('.dsh-mmd-textarea')?.value, 'flowchart LR\nA-->');

    invalid.code.textContent = 'flowchart LR\nA-->RECOVERED';
    await wait(700);
    assert.equal(invalidCard?.dataset.state, 'ok');
    assert.equal(invalidViewControls[0].hidden, false);
    assert.equal(invalidViewControls[1].hidden, false);

    const renderCountBeforeOversized = state.renderCalls.length;
    const oversized = addCodeBlock(`flowchart LR\n${'A-->B\n'.repeat(2_001)}`);
    await wait(1_100);
    const oversizedCard = oversized.pre.previousElementSibling;
    assert.equal(oversizedCard?.dataset.state, 'error');
    assert.match(oversizedCard?.querySelector('.dsh-mmd-error')?.textContent || '', /2000 行/);
    assert.equal(oversizedCard?.querySelector('.dsh-mmd-view-control')?.hidden, false);
    const oversizedActions = oversizedCard?.querySelectorAll('.dsh-mmd-diagram-action') || [];
    assert.notEqual(window.getComputedStyle(oversizedActions[0]).display, 'none');
    assert.equal(oversizedActions[0].disabled, true);
    assert.equal(oversizedCard?.querySelector('.dsh-mmd-textarea')?.value.startsWith('flowchart LR'), true);
    assert.equal(state.renderCalls.length, renderCountBeforeOversized);

    code.textContent = 'flowchart LR\nA-->FINAL';
    await wait(700);
    assert.equal(card.querySelector('.dsh-mmd-pane')?.dataset.state, 'ok');
    assert.equal(window.getComputedStyle(codeButton).minHeight, '30px');
  } finally {
    await harness.cleanup();
  }
});
