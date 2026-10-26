import assert from 'node:assert/strict';

const [scenario, runtimeUrl] = process.argv.slice(2);
const labeledFlowchart = 'flowchart LR\n A["开始"] --> B["结束"]';

assert.equal(typeof globalThis.window, 'undefined');
assert.equal(typeof globalThis.document, 'undefined');

async function installTestDom() {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'http://localhost/' });
  globalThis.window = window;
  globalThis.document = window.document;
  return window;
}

function isMissingDomError(error) {
  // A known limitation of the pinned browser runtime, not a syntax classifier.
  return error instanceof TypeError && /(?:addHook|sanitize) is not a function/.test(error.message);
}

if (scenario === 'with-dom') {
  const window = await installTestDom();
  try {
    const { default: runtime, createTooltipPositioner } = await import(runtimeUrl);
    assert.equal(typeof createTooltipPositioner, 'function');
    runtime.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });

    for (const source of [
      labeledFlowchart,
      'graph LR\n A["开始"] --> B["结束"]',
      'stateDiagram-v2\n [*] --> Ready\n Ready --> [*]',
      'classDiagram\n class Animal {\n +int age\n }',
      'timeline\n 2026 : 发布',
      'gantt\n title 计划\n section 工作\n Task :a, 2026-10-15, 1d',
      'sequenceDiagram\n A->>B: 你好',
      'erDiagram\n CUSTOMER ||--o{ ORDER : places',
    ]) {
      const result = await runtime.parse(source);
      assert.ok(result?.diagramType, `expected successful parsing: ${source}`);
    }

    for (const source of [
      'flowchart LR\n A -->',
      'flowchart LR\n A["x" --> B',
      'pie\n "x": abc',
      'notADiagram\n A --> B',
    ]) {
      // Rejection is the contract: do not assume every parser exposes .hash.
      await assert.rejects(runtime.parse(source), `expected invalid input to be rejected: ${source}`);
    }
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    await window.happyDOM.close();
  }
} else if (scenario === 'without-dom' || scenario === 'dom-after-import') {
  const { default: runtime } = await import(runtimeUrl);
  await assert.rejects(runtime.parse(labeledFlowchart), isMissingDomError);

  if (scenario === 'without-dom') {
    await assert.rejects(runtime.parse('stateDiagram-v2\n [*] --> S'), isMissingDomError);
    assert.ok((await runtime.parse('sequenceDiagram\n A->>B: hi'))?.diagramType);
  } else {
    const window = await installTestDom();
    try {
      const { default: cachedRuntime } = await import(runtimeUrl);
      assert.equal(cachedRuntime, runtime);
      await assert.rejects(cachedRuntime.parse(labeledFlowchart), isMissingDomError);
    } finally {
      delete globalThis.window;
      delete globalThis.document;
      await window.happyDOM.close();
    }
  }
} else {
  throw new Error(`Unknown runtime probe scenario: ${scenario}`);
}
