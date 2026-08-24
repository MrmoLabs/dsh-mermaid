# Changelog

All notable changes to this project are documented in this file.

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

[0.2.0]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MrmoLabs/dsh-mermaid/releases/tag/v0.1.0
