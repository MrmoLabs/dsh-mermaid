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
    const { default: runtime, createTooltipPositioner, isMermaidSourceError, renderMermaid } = await import(runtimeUrl);
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

    // Every security/resource default stays locked against native diagram overrides.
    for (const prefix of [
      '---\nconfig:\n  theme: base\n  look: handDrawn\n  securityLevel: loose\n  startOnLoad: true\n  maxTextSize: 999999\n  maxEdges: 999999\n  suppressErrorRendering: false\n  secure: []\n---\n',
      '%%{init: {"theme":"base","look":"handDrawn","securityLevel":"loose","startOnLoad":true,"maxTextSize":999999,"maxEdges":999999,"suppressErrorRendering":false,"secure":[]}}%%\n',
    ]) {
      runtime.initialize({ theme: 'forest', look: 'classic', startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: 50000, maxEdges: 2000 });
      await runtime.parse(prefix + labeledFlowchart);
      const config = runtime.mermaidAPI.getConfig();
      assert.equal(config.theme, 'base');
      assert.equal(config.look, 'handDrawn');
      assert.equal(config.securityLevel, 'strict');
      assert.equal(config.startOnLoad, false);
      assert.equal(config.maxTextSize, 50000);
      assert.equal(config.maxEdges, 2000);
      assert.equal(config.suppressErrorRendering, true);
      for (const key of ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges']) assert.ok(config.secure.includes(key));
      runtime.initialize({ theme: 'forest', look: 'classic', startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true });
      await runtime.parse(labeledFlowchart);
      assert.equal(runtime.mermaidAPI.getConfig().theme, 'forest');
      assert.equal(runtime.mermaidAPI.getConfig().look, 'classic');
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
      ['%%{init: {"theme":"base","themeVariables":{"fontFamily":"A[Keep(test)]"}}}%%\n', '\n'],
      ['%% Leading comment\r\n%%{init: {\r\n  "theme":"base",\r\n  "look":"handDrawn"\r\n}}%%\r\n%% Keep this too\r\n', '\r\n'],
      ['---\nconfig:\n  theme: base\n---\n%%{init: {"look":"handDrawn"}}%%\n', '\n'],
    ]) {
      const source = prefix + issue9.replaceAll('\n', newline);
      const quoted = prefix + quotedIssue9.replaceAll('\n', newline);
      assert.equal((await renderMermaid('issue9-with-prefix', source)).diagramType, 'flowchart-v2');
      assert.deepEqual(renderCalls.splice(0), [source, quoted]);
    }

    const invalid = `${original}\n  F -->`;
    await assert.rejects(renderMermaid('invalid', invalid), (error) => error?.hash?.token === 'PS');
    assert.deepEqual(renderCalls.splice(0), [invalid, `${normalized}\n  F -->`]);

    const embeddedQuotes = `flowchart LR
A[事实层
每次唤醒采样一次
OS关联三态 / 0x59 / 端口活跃 / 拨号错误族 / USB/射频/前台] --> B[分类层
WifiDialFailurePolicy 纯函数
socketError+事实 → NoRoute/Refused/Timeout]
B --> C[结果层
WifiConnectResult
TcpFailed 只留"关联在+拒连/超时"]
C --> D[决策层
WifiRecoveryMachine 纯内核
只吃原因，决定动作与节拍]
D --> E[执行层
LinkRebuildPlan
KeepSocket/RebuildDataPort/RebuildSockets/FullReconnect]
E --> F[传输层
三件套常驻 + 只换 socket + 定长缓冲]
F --> A`;
    const escaped = embeddedQuotes.replace('"关联在+拒连/超时"', '#quot;关联在+拒连/超时#quot;');
    await assert.rejects(runtime.parse(embeddedQuotes), (error) => error?.hash?.token === 'STR');
    assert.equal((await renderMermaid('embedded-quotes', embeddedQuotes)).diagramType, 'flowchart-v2');
    assert.deepEqual(renderCalls.splice(0), [embeddedQuotes, escaped]);

    const contexts = [
      '---', 'title: Keep A[example "text"]', '---', 'graph LR',
      '  %% Keep A[example "text"]',
      '  A["Keep B[quoted]"] -->|"Keep C[edge]"| B',
      '  B --> C@{ shape: rect, label: "Keep D[metadata]" }',
      '  C --> D[Choose "left" or "right"]',
    ].join('\r\n');
    const escapedContexts = contexts.replace('"left" or "right"', '#quot;left#quot; or #quot;right#quot;');
    assert.equal((await renderMermaid('quotes-with-context', contexts)).diagramType, 'flowchart-v2');
    assert.deepEqual(renderCalls.splice(0), [contexts, escapedContexts]);
    await renderMermaid('escaped-quotes', escapedContexts);
    assert.deepEqual(renderCalls.splice(0), [escapedContexts]);

    const missingQuote = 'flowchart LR\n A[Keep "text]';
    await assert.rejects(renderMermaid('unpaired-quote', missingQuote), (error) => error?.hash?.token === 'STR');
    assert.deepEqual(renderCalls.splice(0), [missingQuote]);

    const brokenLink = `${embeddedQuotes}\n F -->`;
    await assert.rejects(renderMermaid('broken-link', brokenLink), (error) => error?.hash?.token === 'STR');
    assert.deepEqual(renderCalls.splice(0), [brokenLink, `${escaped}\n F -->`]);

    for (const [name, source, normalizedSource] of [
      ['quotes-then-parentheses', 'A[Selected "node"]-->B[Select(node)]', 'A[Selected #quot;node#quot;]-->B["Select(node)"]'],
      ['parentheses-then-quotes', 'A[Select(node)]-->B[Selected "node"]', 'A["Select(node)"]-->B[Selected #quot;node#quot;]'],
      ['both-in-one-label', 'A[Select(node) "quoted"]-->B', 'A["Select(node) #quot;quoted#quot;"]-->B'],
    ]) {
      assert.equal((await renderMermaid(name, `flowchart LR\n${source}`)).diagramType, 'flowchart-v2');
      assert.equal(renderCalls.at(-1), `flowchart LR\n${normalizedSource}`);
      assert.ok(renderCalls.splice(0).length <= 3);
    }
    await assert.rejects(renderMermaid('incomplete', 'flowchart LR\nA -->'), (error) => error.incomplete && error.line === 2);

    for (const source of ['flowchart LR\n A -->', 'pie\n "x": abc', 'pie\n "x": -2', 'notADiagram\n A --> B']) {
      await assert.rejects(renderMermaid('source-error', source), isMermaidSourceError);
    }

    const drawError = new Error('drawing failed');
    runtime.render = async (_id, source, container) => {
      container.append(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
      await runtime.parse(source);
      throw drawError;
    };
    // A recognized label error can be repaired successfully even when layout then fails.
    for (const source of [labeledFlowchart, embeddedQuotes]) {
      await assert.rejects(renderMermaid('draw-error', source), (error) => error === drawError && !isMermaidSourceError(error));
      assert.equal(document.body.querySelector('svg'), null, 'the failed render left a staging SVG');
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
