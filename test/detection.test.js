import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramType, hasMermaidLanguage, isMermaidSource } from '../src/detection.js';

test('recognizes supported language classes', () => {
  assert.equal(hasMermaidLanguage(['language-mermaid']), true);
  assert.equal(hasMermaidLanguage(['language-MMD']), true);
  assert.equal(hasMermaidLanguage(['language-javascript']), false);
});

test('recognizes supported diagram sources', () => {
  assert.equal(diagramType('  flowchart TD\nA-->B'), 'flowchart');
  assert.equal(isMermaidSource('sequenceDiagram\nA->>B: hello'), true);
  assert.equal(isMermaidSource('console.log("flowchart")'), false);
});

test('source classification is independent from the DOM block guard', () => {
  assert.equal(isMermaidSource('flowchart'), true);
  assert.equal(hasMermaidLanguage([]), false);
});
