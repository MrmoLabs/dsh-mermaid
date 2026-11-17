import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { rewriteSvgIds } from '../src/svg.js';

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
