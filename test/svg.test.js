import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { prepareSvgPreview, rewriteSvgIds } from '../src/svg.js';

test('measures visible SVGs and expands a clipped Journey viewBox', async () => {
  const window = new Window();
  try {
    const svg = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.defineProperty(svg, 'viewBox', { value: { baseVal: { x: 0, y: 0, width: 100, height: 50 } } });
    svg.getClientRects = () => [];
    svg.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
    assert.equal(prepareSvgPreview(svg, 'journey'), true);
    svg.getClientRects = () => [{}];
    assert.equal(prepareSvgPreview(svg, 'journey'), false);
    svg.getBBox = () => ({ x: -12, y: 4, width: 125, height: 28 });
    assert.equal(prepareSvgPreview(svg, 'journey'), true);
    assert.equal(svg.getAttribute('viewBox'), '-12 0 125 50');
  } finally { await window.happyDOM.close(); }
});

test('fullscreen SVG remaps complete CSS IDs and gradient URLs with shared prefixes', async () => {
  const window = new Window();
  try {
    const svg = new window.DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" id="diagram">
      <style>#diagram .node{stroke:url(#diagram-gradient)} #n1{fill:red} #n10{fill:blue} @media print{#n10{stroke:url('#diagram-gradient')}}</style>
      <defs><linearGradient id="diagram-gradient"/></defs>
      <rect class="first node" id="n1" fill="url(#diagram-gradient)"/>
      <rect class="second node" id="n10"/>
    </svg>`, 'image/svg+xml').documentElement;
    rewriteSvgIds(svg);
    const gradient = svg.querySelector('linearGradient').id;
    const first = svg.querySelector('.first').id;
    const second = svg.querySelector('.second').id;
    const css = svg.querySelector('style').textContent;
    assert.ok(css.includes(`#${svg.id} .node{stroke:url(#${gradient})}`));
    assert.ok(css.includes(`#${first}{fill:red}`));
    assert.ok(css.includes(`#${second}{fill:blue}`));
    assert.ok(css.includes(`@media print{#${second}{stroke:url('#${gradient}')}}`));
    assert.equal(svg.querySelector('.first').getAttribute('fill'), `url(#${gradient})`);
    assert.doesNotMatch(css, /#diagram|#n1\b|#n10\b/);
  } finally { await window.happyDOM.close(); }
});

test('CSS remapping preserves colors, comments, strings and unknown references', async () => {
  const window = new Window();
  try {
    const svg = new window.DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">
      <style>/* #fff and #node\\:a */ #fff{fill:#fff;content:"#fff {"} #node\\:a{stroke:url("#fff");fill:url(#foreign)} .note{content:'brace { #fff'} .other{fill:#fff /* { */} </style>
      <rect id="fff"/><rect id="node:a"/>
    </svg>`, 'image/svg+xml').documentElement;
    rewriteSvgIds(svg);
    const [first, second] = svg.querySelectorAll('rect');
    const css = svg.querySelector('style').textContent;
    assert.ok(css.includes(`/* #fff and #node\\:a */ #${first.id}{fill:#fff;content:"#fff {"}`));
    assert.ok(css.includes(`#${second.id}{stroke:url("#${first.id}");fill:url(#foreign)}`));
    assert.ok(css.includes("content:'brace { #fff'"));
    assert.ok(css.includes('.other{fill:#fff /* { */}'));
  } finally { await window.happyDOM.close(); }
});
