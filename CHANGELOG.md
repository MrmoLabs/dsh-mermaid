# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

- Localize plugin-owned interface, status, and error text in Simplified Chinese and English based on the host page and browser language.
- Add polite render and download announcements plus accessible names for generated SVG diagrams.
- Replace the single-item More menu with a direct SVG download action.
- Keep keyboard focus inside the fullscreen viewer, isolate background content, and restore focus when the viewer closes.
- Increase interactive targets to at least 28 CSS pixels and add a high-visibility keyboard focus indicator.
- Hide the Diagram and Code view controls when rendering fails or exceeds limits, then restore them automatically after a successful rerender.
- Split browser styles, SVG utilities, and fullscreen viewer behavior out of the client lifecycle orchestrator.
- Split the monolithic browser integration test into focused rendering, viewer, concurrency, and lifecycle suites with a shared harness.
- Remove the redundant Mermaid diagram title from the card toolbar while retaining the diagram-type badge.
- Preserve the diagram-action layout width in code view so the Diagram and Code controls do not shift when toggled.
- Keep fullscreen and SVG download controls visible in both Diagram and Code views, hiding them only when no rendered SVG is available.
- Place the Code view control before the Diagram view control in the card toolbar.

## [0.3.1] - 2026-09-04

- Prevent Mermaid parse failures from leaving temporary built-in error SVG elements in the document while preserving the existing source-code fallback.

## [0.3.0] - 2026-08-24

- Add a fullscreen Mermaid viewer with zoom, pan, 100% reset, and fit-to-window controls.
- Use an opaque theme-aware viewer background so the underlying conversation never shows through.
- Add SVG export from each successfully rendered diagram card.
- Close the viewer with Escape, restore page scrolling, and keep an open viewer synchronized with rerenders.
- Render diagrams through a deduplicated serial queue and yield between renders to avoid concurrent main-thread work.
- Reject oversized diagrams before loading Mermaid, with 50,000-character and 2,000-line limits plus Mermaid edge protection.
- Rewrite IDs and internal references in fullscreen SVG clones to avoid collisions with the in-card diagram.
- Preserve Mermaid styling after SVG ID isolation by rewriting ID references inside embedded stylesheets.
- Keep the diagram point under the mouse stationary while zooming with the wheel.
- Document the last verified DSH and Node.js versions.
- Discover Mermaid blocks that begin empty during streaming and recover if the host removes an injected card while retaining its code block.
- Add DOM integration coverage for fullscreen controls, SVG export, and cleanup.

## [0.2.0] - 2026-08-24

- Reduce the DSH startup bundle from about 3.45 MB to 8.7 KB by loading the bundled Mermaid runtime on demand.
- Serve the pinned Mermaid runtime from a versioned, same-origin plugin route without relying on a CDN.
- Share one runtime-loading promise across all diagrams and preserve stale-render protection during loading.
- Deduplicate code-block discovery and render scheduling within each MutationObserver batch.
- Add DOM lifecycle, theme, stale-render, ModuleLoader registration, bundle-size, and host-route tests.

## [0.1.3] - 2026-08-24

- Remove the redundant 1.5-second full-page code-block rescan.
- Keep the initial scan and MutationObserver-based incremental discovery for newly streamed content.
- Reduce continuous DOM-query overhead during long-running DSH Web sessions.

## [0.1.2] - 2026-08-24

- Keep the source-code view inside the Mermaid card instead of revealing the detached DSH code block.
- Remove the empty diagram-body frame when switching to source code.
- Preserve rendering errors alongside the in-card source view.
- Fail the build if the generated browser bundle does not register the quoted `dsh-mermaid` ModuleLoader ID.

## [0.1.1] - 2026-08-23

- Move Mermaid from runtime dependencies to development dependencies because it is already bundled into the client artifact.
- Reduce an isolated consumer installation from 114 packages and 128.14 MiB to one package and 3.31 MiB.
- Upgrade esbuild from 0.25.9 to 0.28.2.
- Avoid duplicate builds during npm publishing.
- Add Windows GitHub Actions checks using Node.js 22.23.0.
- Correct the DSH workspace update commands in both READMEs.
- Replace manually maintained README version text with the npm version badge.

## [0.1.0] - 2026-08-23

- Initial public release.
- Render Mermaid fenced code blocks as SVG diagrams in DSH Web.
- Add diagram/source switching, dark-theme rerendering, streaming support, strict Mermaid security, and npm/GitHub installers.

[0.3.0]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MrmoLabs/dsh-mermaid/releases/tag/v0.1.0
