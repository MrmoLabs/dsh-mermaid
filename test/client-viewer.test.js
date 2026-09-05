import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientHarness } from '../test-support/client-harness.js';

test('supports accessible fullscreen viewing and direct SVG download', async () => {
  const harness = await createClientHarness();
  const { document, pre, state, wait, window } = harness;
  try {
    await wait(1_100);
    const card = document.querySelector('.dsh-mmd');
    const originalSvg = card.querySelector('.dsh-mmd-pane svg');
    const embeddedStyle = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    embeddedStyle.textContent = '#diagram .node{fill:red}.edge{marker-end:url(#arrow)}';
    originalSvg.prepend(embeddedStyle);

    const buttons = card.querySelectorAll('.dsh-mmd-btn');
    assert.match(document.getElementById('dsh-mermaid/css')?.textContent || '', /\.dsh-mmd-btn:focus-visible\{outline:2px solid/);
    buttons[2].focus();
    buttons[2].click();
    const viewer = document.querySelector('.dsh-mmd-viewer');
    assert.equal(viewer?.hidden, false);
    assert.equal(document.body.style.overflow, 'hidden');
    assert.equal(card.inert, true);
    assert.equal(pre.inert, true);

    const closeButton = viewer.querySelector('[aria-label="关闭全屏查看"]');
    const zoomOutButton = viewer.querySelector('[aria-label="缩小"]');
    assert.equal(document.activeElement, closeButton);
    closeButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, zoomOutButton);
    zoomOutButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(document.activeElement, closeButton);

    const viewerSvg = viewer.querySelector('.dsh-mmd-viewer-stage svg');
    const originalMarkerId = originalSvg.querySelector('marker')?.id;
    const viewerMarker = viewerSvg?.querySelector('marker');
    assert.notEqual(viewerSvg?.id, originalSvg.id);
    assert.notEqual(viewerMarker?.id, originalMarkerId);
    assert.equal(viewerSvg?.querySelector('path[marker-end]')?.getAttribute('marker-end'), `url(#${viewerMarker.id})`);
    assert.match(viewerSvg?.querySelector('style')?.textContent || '', new RegExp(`#${viewerSvg.id} \\.node`));
    assert.match(viewerSvg?.querySelector('style')?.textContent || '', new RegExp(`url\\(#${viewerMarker.id}\\)`));

    viewer.querySelector('[aria-label="放大"]')?.click();
    const viewport = viewer.querySelector('.dsh-mmd-viewer-viewport');
    viewport.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 1_000, height: 800, right: 1_000, bottom: 800, x: 0, y: 0,
      toJSON() { return this; },
    });
    const transformBefore = viewer.querySelector('.dsh-mmd-viewer-stage')?.style.transform;
    viewport.dispatchEvent(new window.WheelEvent('wheel', {
      deltaY: -100, clientX: 800, clientY: 400, bubbles: true, cancelable: true,
    }));
    assert.notEqual(viewer.querySelector('.dsh-mmd-viewer-stage')?.style.transform, transformBefore);

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(viewer.hidden, true);
    assert.equal(document.body.style.overflow, '');
    assert.equal(card.inert, false);
    assert.equal(document.activeElement, buttons[2]);

    buttons[3].click();
    assert.equal(card.querySelector('.dsh-mmd-menu'), null);
    assert.equal(state.downloadedName, 'mermaid-flowchart.svg');
    assert.equal(card.querySelector('[role="status"]')?.textContent, 'SVG 已下载。');
    assert.equal(state.objectUrls[0].type, 'image/svg+xml;charset=utf-8');
    await wait(10);
    assert.deepEqual(state.revokedUrls, ['blob:test-1']);
  } finally {
    await harness.cleanup();
  }
});
