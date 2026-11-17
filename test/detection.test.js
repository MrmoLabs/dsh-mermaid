import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diagramBodyOffset,
  diagramType,
  hasExplicitLanguage,
  hasMermaidLanguage,
  isMermaidSource,
} from '../src/detection.js';

test('recognizes supported language classes', () => {
  assert.equal(hasMermaidLanguage(['language-mermaid']), true);
  assert.equal(hasMermaidLanguage(['language-MMD']), true);
  assert.equal(hasMermaidLanguage(['language-javascript']), false);
  assert.equal(hasExplicitLanguage(['language-javascript']), true);
  assert.equal(hasExplicitLanguage(['shiki']), false);
});

test('shared body scanner retains exact prefix offsets and rejects incomplete or oversized input', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const prefix = ['\uFEFF  ', '  ---', '  title: A[Keep(test)]', '  ---', '%% note', '%%{init: {', '"theme":"base"', '}}%%', '  '].join(newline);
    const source = prefix + 'flowchart LR' + newline + 'A-->B';
    assert.equal(diagramBodyOffset(source), prefix.length);
    assert.equal(source.slice(diagramBodyOffset(source)), 'flowchart LR' + newline + 'A-->B');
  }
  for (const source of ['', '---\nflowchart LR', '%%{init: {\nflowchart LR', '%%{init: {}}%% trailing\nflowchart LR', ' '.repeat(50_001)]) {
    assert.equal(diagramBodyOffset(source), -1);
  }
});

test('recognizes supported diagram sources', () => {
  assert.equal(diagramType('  flowchart TD\nA-->B'), 'flowchart');
  assert.equal(diagramType('graph LR\nA-->B'), 'graph');
  assert.equal(diagramType('%% note\nflowchart LR\nA-->B'), 'flowchart');
  assert.equal(diagramType('---\ntitle: demo\n---\nflowchart LR\nA-->B'), 'flowchart');
  assert.equal(isMermaidSource('%% note\nflowchart LR\nA-->B'), true);
  assert.equal(isMermaidSource('graph LR\nA-->B'), true);
  assert.equal(isMermaidSource('sequenceDiagram\nA->>B: hello'), true);
  assert.equal(isMermaidSource('console.log("flowchart")'), false);
});

test('source classification is independent from the DOM block guard', () => {
  assert.equal(isMermaidSource('flowchart'), true);
  assert.equal(hasMermaidLanguage([]), false);
});

test('scans closed indented configuration and multiline directives across line endings', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const prefix = ['\uFEFF  ', '  ---', '  config:', '    themeVariables:', '      title: flowchart', '  ---', '%% comment', '  %%{init: {', '    "theme": "dark"', '  }}%%', '%% more', ''].join(newline);
    assert.equal(diagramType(`${prefix}sequenceDiagram${newline}A->>B: hello`), 'sequenceDiagram');
  }
  for (const source of ['---\nconfig:\n theme: flowchart', '%%{init: {\nflowchart LR\nA-->B', 'title: flowchart\nA-->B', '---\nvalue: flowchart\n---\n', '%%{init: {"x": "flowchart"}}%%']) {
    assert.equal(isMermaidSource(source), false, source);
  }
});
