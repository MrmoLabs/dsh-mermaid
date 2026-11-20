# Changelog

All notable changes to this project are documented in this file.

## [0.5.0] - 2026-11-20

- Preview valid diagrams during native Markdown streaming and retain the last visible diagram while the source is incomplete.
- Add touch pinch and double-tap zoom in the card and fullscreen viewer.
- Recover unquoted parentheses in flowchart diamond labels and support ZenUML diagrams.
- Load diagram modules on demand and retry failed imports with fresh module URLs.
- Increase small PNG exports to 3× within the existing dimension and pixel limits.
- Add an inline Mermaid editor with a debounced live preview. Drafts stay on the current page; Copy and Download .mmd preserve the raw draft, and Reset restores the original message source.
- Keep invalid diagrams editable and retain the last successful preview while a draft is invalid or rendering. Disable fullscreen and SVG export until the preview matches the draft.
- Add global color themes, independent classic/hand-drawn looks, and custom light/dark color and font settings saved in the DSH profile. Per-diagram Mermaid configuration can override the defaults.
- Add a rendering-style form on the plugin's Plugins page, with common controls, advanced JSON variables, an Indigo/Slate example, restore/discard actions and save-conflict handling. Settings drafts survive panel navigation.
- Preserve existing colors and variables when repairing invalid settings, and avoid unnecessary save prompts. Base color and node fill can be adjusted independently.
- Fix preview updates during IME composition and rapid source/theme changes. Preserve fullscreen zoom during updates and keep Reset/export working after a failed preview update.
- Preserve init directives when recovering flowchart labels with unquoted parentheses, and fix gradient borders in fullscreen diagrams.
- Recover embedded quotes in flowchart labels containing plain HTML line breaks while preserving the original Mermaid source.
- Update Web/Desktop compatibility, installation and upgrade guidance, including saved-profile preservation and fixed-theme contrast limitations.
- Measure diagram bounds before exporting SVG or PNG after a retry in Code view.
- Keep Base nodes readable when only typography is customized.
- Choose a readable default node label color for an opaque hex fill when node text is left unset in Base.
- Pin the bundled KaTeX renderer to 0.18.2.

## [0.4.5] - 2026-11-06

- Keep viewer controls below Electron's native title bar overlay and outside window drag regions.
- Export standalone SVG as XML, including HTML labels with line breaks.
- Retry flowcharts with simple unquoted parentheses in edge or node labels while keeping the original source in Code view.

## [0.4.4] - 2026-10-27

- Allow Code/Diagram switching before the lazy Mermaid runtime has loaded.
- Remove stale diagram cards and fullscreen content when streamed source is cleared, including while a render is still pending; enhance the block again when content resumes.
- Close fullscreen on render errors or source limits and focus the current code; ignore failures from superseded renders.
- Include the tooltip overflow and conversation scrolling fixes prepared in 0.4.3 in the npm release.

## [0.4.3] - 2026-10-26

- Reconcile DSH's existing return-to-bottom action when switching to a shorter Mermaid view reaches the physical bottom, clearing the stale button and saved reading position without moving readers who still have content below.
- Keep view-position handling in the lazy runtime so the client bootstrap stays below its existing size budget.
- Keep the visually hidden live status inside its diagram card so tall diagrams and code view cannot add page-level overflow while scrolling a conversation.
- Prevent Mermaid's hidden tooltip from adding page-level overflow; preserve shared tooltip bindings, scroll coordinates, custom transforms, and cleanup across plugin instances.
- Cancel pending first mounts when the plugin is unloaded, including immediate disable/re-enable cycles.
- Refresh sanitizer and test DOM dependencies and audit bundled development dependencies in CI and publishing checks.
- Document browser-runtime requirements, internal package boundaries, and server-side parsing limitations in English and Simplified Chinese.
- Add real bundled-runtime parser coverage for labeled diagrams, invalid syntax, missing DOM, and module initialization caching in isolated processes.

## [0.4.2] - 2026-10-15

- Keep fullscreen viewer controls below the DSH Desktop titlebar on Windows.
- Localize the GitHub-source installer CLI in English and Simplified Chinese, with an explicit language override and profile-specific restart guidance for DSH Desktop.
- Show a localized missing-DSH error on Windows and use the system language when environment locale values are neutral.

## [0.4.1] - 2026-09-23

- Fix detection of Mermaid diagrams using graph syntax and avoid treating explicitly labeled non-Mermaid code blocks as diagrams.

## [0.4.0] - 2026-09-05

- Localize plugin-owned interface, status, and error text in Simplified Chinese and English based on the host page and browser language.
- Add polite render and download announcements plus accessible names for generated SVG diagrams.
- Replace the single-item More menu with a direct SVG download action.
- Keep keyboard focus inside the fullscreen viewer, isolate background content, and restore focus when the viewer closes.
- Increase interactive targets to at least 28 CSS pixels and add a high-visibility keyboard focus indicator.
- Hide the Diagram and Code view controls when rendering fails or exceeds limits, then restore them automatically after a successful rerender.
- Split browser styles, SVG utilities, and fullscreen viewer behavior out of the client lifecycle orchestrator.
- Split the monolithic browser integration test into focused rendering, viewer, concurrency, and lifecycle suites with a shared harness.
- Remove the redundant Mermaid diagram title from the card toolbar while retaining the diagram-type badge.
- Keep fullscreen and SVG download controls visible in both Diagram and Code views, hiding them only when no rendered SVG is available.
- Place the Code view control before the Diagram view control in the card toolbar.
- Preserve the toolbar's viewport position when switching between Code and Diagram views.
- Verify compatibility with `@deepseek-ai/dsh 0.1.2-rc.1` and Node.js 22.23.2.

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

[0.4.0]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MrmoLabs/dsh-mermaid/releases/tag/v0.1.0
