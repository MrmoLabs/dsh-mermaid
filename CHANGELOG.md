# Changelog

All notable changes to this project are documented in this file.

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

[0.1.1]: https://github.com/MrmoLabs/dsh-mermaid/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MrmoLabs/dsh-mermaid/releases/tag/v0.1.0
