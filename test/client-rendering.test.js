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

    const buttons = card.querySelectorAll('.dsh-mmd-btn');
    buttons[1].click();
    assert.equal(card.dataset.view, 'code');
    assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
    assert.equal(card.querySelector('.dsh-mmd-code')?.textContent, 'flowchart LR\nA-->B');
    const diagramActions = card.querySelectorAll('.dsh-mmd-diagram-action');
    const actionSlot = card.querySelector('.dsh-mmd-action-slot');
    assert.notEqual(window.getComputedStyle(diagramActions[0]).display, 'none');
    assert.notEqual(window.getComputedStyle(diagramActions[1]).display, 'none');
    assert.equal(diagramActions[0].parentElement, actionSlot);
    assert.equal(diagramActions[1].parentElement, actionSlot);
    buttons[0].click();
    assert.equal(card.dataset.view, 'diagram');
    assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
    assert.doesNotMatch(
      document.getElementById('dsh-mermaid/css')?.textContent || '',
      /\[data-view='code'\]\[data-state='ok'\] \.dsh-mmd-diagram-action\{display:none\}/,
    );

    document.documentElement.lang = 'en-US';
    await wait(10);
    assert.equal(card.querySelector('.dsh-mmd-label'), null);
    assert.equal(buttons[0].textContent, 'Diagram');
    document.documentElement.lang = 'zh-CN';
    await wait(10);

    const invalid = addCodeBlock('flowchart LR\nA-->');
    await wait(1_100);
    const invalidCard = invalid.pre.previousElementSibling;
    assert.equal(invalidCard?.dataset.state, 'error');
    assert.equal(invalidCard?.dataset.view, 'code');
    assert.match(invalidCard?.querySelector('.dsh-mmd-error')?.textContent || '', /渲染失败/);
    assert.equal(invalidCard?.querySelector('[role="status"]')?.textContent, '图表渲染失败，已显示源代码。');
    const invalidViewControls = invalidCard?.querySelectorAll('.dsh-mmd-view-control') || [];
    assert.equal(invalidViewControls[0].hidden, true);
    assert.equal(invalidViewControls[1].hidden, true);

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
    assert.equal(oversizedCard?.querySelector('.dsh-mmd-view-control')?.hidden, true);
    assert.equal(window.getComputedStyle(oversizedCard?.querySelector('.dsh-mmd-diagram-action')).display, 'none');
    assert.equal(state.renderCalls.length, renderCountBeforeOversized);

    code.textContent = 'flowchart LR\nA-->FINAL';
    await wait(700);
    assert.equal(card.querySelector('.dsh-mmd-pane')?.dataset.state, 'ok');
    assert.equal(window.getComputedStyle(buttons[0]).minHeight, '28px');
  } finally {
    await harness.cleanup();
  }
});
