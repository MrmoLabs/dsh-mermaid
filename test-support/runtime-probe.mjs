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
    const { default: runtime, createTooltipPositioner, renderMermaid } = await import(runtimeUrl);
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

    // Exercise the render adapter with the real parser and no layout dependency.
    const renderCalls = [];
    runtime.render = async (_id, source) => {
      renderCalls.push(source);
      return runtime.parse(source);
    };
    const original = [
      'flowchart LR',
      '  %% Keep this comment: A[Not a node(test)]',
      '  A["Already quoted B[example(text)]"] -->|UsbPresence(true/false)| C',
      '  C --> E[SwitchToUsb / SetFlag(false)]',
      '  E --> F[(Cylinder)]',
    ].join('\n');
    const normalized = original
      .replace('|UsbPresence(true/false)|', '|"UsbPresence(true/false)"|')
      .replace('[SwitchToUsb / SetFlag(false)]', '["SwitchToUsb / SetFlag(false)"]');
    assert.equal((await renderMermaid('issue9', original)).diagramType, 'flowchart-v2');
    assert.deepEqual(renderCalls.splice(0), [original, normalized]);

    await renderMermaid('valid', normalized);
    assert.deepEqual(renderCalls.splice(0), [normalized]);

    const issue9 = [
      'flowchart LR',
      '    subgraph 外壳[ProbeDrive 外壳: 事件映射 + 效果执行]',
      '      W[UsbPresenceWatch<br/>2s 采样 · 仅非USB或回退窗挂起时]',
      '      G[WiFi 守卫<br/>补偿入口 / 自动连接入口]',
      '      A[仲裁泵 PostModeArbitration]',
      '    end',
      '    subgraph 内核[ModeArbitrationMachine: 纯判定]',
      '      S[新增 _usbPresent 状态]',
      '      R1[UsbPresence: 在场+非USB → 抢占切USB]',
      '      R2[UsbLinkEstablished → 取消回退窗]',
      '      R3[OnTick 到期: 在场 → 保持USB]',
      '    end',
      '    W -->|UsbPresence(true/false)| A --> S',
      '    G -->|立即发布在场| A',
      '    R1 --> E[SwitchToUsb / PauseWifiRecovery / CancelWifiInFlight / SetFlag(false)]',
      '    R2 --> C[CancelFallbackWindow]',
      '    R3 --> C',
    ].join('\n');
    const quotedIssue9 = issue9
      .replace('|UsbPresence(true/false)|', '|"UsbPresence(true/false)"|')
      .replace('[SwitchToUsb / PauseWifiRecovery / CancelWifiInFlight / SetFlag(false)]',
        '["SwitchToUsb / PauseWifiRecovery / CancelWifiInFlight / SetFlag(false)"]');
    for (const [prefix, newline] of [
      ['%% Leading comment A[Keep(test)]\n\n', '\n'],
      ['---\r\ntitle: A[Keep(test)]\r\nconfig:\r\n  look: handDrawn\r\n---\r\n%% Keep this too\r\n', '\r\n'],
    ]) {
      const source = prefix + issue9.replaceAll('\n', newline);
      const quoted = prefix + quotedIssue9.replaceAll('\n', newline);
      assert.equal((await renderMermaid('issue9-with-prefix', source)).diagramType, 'flowchart-v2');
      assert.deepEqual(renderCalls.splice(0), [source, quoted]);
    }

    const invalid = `${original}\n  F -->`;
    await assert.rejects(renderMermaid('invalid', invalid), (error) => error?.hash?.token === 'PS');
    assert.deepEqual(renderCalls, [invalid, `${normalized}\n  F -->`]);
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
