import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('recognizes supported diagram sources', () => {
  assert.equal(diagramType('  flowchart TD\nA-->B'), 'flowchart');
  assert.equal(diagramType('graph LR\nA-->B'), 'graph');
  assert.equal(isMermaidSource('graph LR\nA-->B'), true);
  assert.equal(isMermaidSource('sequenceDiagram\nA->>B: hello'), true);
  assert.equal(isMermaidSource('console.log("flowchart")'), false);
});

test('source classification is independent from the DOM block guard', () => {
  assert.equal(isMermaidSource('flowchart'), true);
  assert.equal(hasMermaidLanguage([]), false);
});
