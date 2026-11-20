// The card contains and clips its absolutely positioned live status during scrolling.
const CSS = `
.dsh-mmd{--dsh-mmd-canvas-height:min(360px,40vh);position:relative;margin:8px 0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));overflow:hidden}
.dsh-mmd-native-fence,.dsh-mmd-native-seat,.dsh-mmd-native-source{display:contents}
.dsh-mmd-native-seat:not(:empty)+.dsh-mmd-native-source{display:none}
.dsh-mmd-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,transparent)}
.dsh-mmd-views{display:inline-flex;max-width:100%;padding:2px;gap:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10))}
.dsh-mmd-file-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:2px;margin-inline-start:auto}
.dsh-mmd-export::after{content:'▾'/'';margin-inline-start:5px}
.dsh-mmd-export-list{position:fixed;inset:auto;min-width:124px;max-height:calc(100vh - 8px);overflow:auto;margin:0;padding:4px;border:1px solid var(--dsw-alias-border-l1,#d6d8df);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);box-shadow:0 4px 14px #0002;position-area:block-end span-inline-start;justify-self:end;position-try-fallbacks:flip-block;position-visibility:anchors-visible}
@supports(position-area:block-end span-inline-start){.dsh-mmd-export-list{margin-block:4px}}
body[data-ds-dark-theme] .dsh-mmd-export-list{background:var(--dsw-alias-bg-layer-1,#222);color:var(--dsw-alias-label-primary,#eee)}
.dsh-mmd-export-list .dsh-mmd-btn{display:block;width:100%;text-align:start;color:inherit;white-space:nowrap}
@supports not selector(:popover-open){.dsh-mmd-export{display:none}.dsh-mmd-export-list{position:static;min-width:0;border:0;box-shadow:none}}
.dsh-mmd-export-error{padding:8px 12px;color:var(--dsw-alias-state-error-primary,#d33);font-size:12px;flex-basis:100%}
.dsh-mmd-btn{appearance:none;min-width:30px;min-height:30px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#666);border-radius:5px;font:inherit;font-size:12px;line-height:1.3;padding:3px 8px;cursor:pointer}
.dsh-mmd-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dsh-mmd-btn:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4c6ef5);outline-offset:2px}
.dsh-mmd-view-control[aria-pressed='true']{border-color:var(--dsw-alias-button-primary-fill,#4c6ef5);color:var(--dsw-alias-label-primary,#202124);background:var(--dsw-alias-interactive-bg-active,rgba(76,110,245,.12));font-weight:600}
body[data-ds-dark-theme] .dsh-mmd-view-control[aria-pressed='true']{color:var(--dsw-alias-label-primary,#f5f5f5)}
.dsh-mmd-btn:disabled{opacity:.45;cursor:not-allowed}
.dsh-mmd-btn:disabled:hover{background:transparent}
.dsh-mmd-error-actions{display:flex;flex-wrap:wrap;gap:4px;padding:4px 12px 0}
.dsh-mmd-error-actions[hidden],.dsh-mmd-retry[hidden]{display:none}
.dsh-mmd-retry,.dsh-mmd-fullscreen{border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.3))}
.dsh-mmd-body{padding:10px 12px}
.dsh-mmd-preview{min-width:0}
.dsh-mmd-panel-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 8px}
.dsh-mmd-preview-label{display:none}
.dsh-mmd-preview-controls{display:none;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:6px}
.dsh-mmd-preview:has(.dsh-mmd-pane>svg) .dsh-mmd-preview-controls{display:flex;margin-inline-start:auto}
.dsh-mmd-pane{display:block}
.dsh-mmd-pane:has(>svg){height:var(--dsh-mmd-canvas-height);display:flex;flex-direction:column;overflow:auto;background-color:var(--dsh-mmd-diagram-background,transparent)}
.dsh-mmd-pane:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4c6ef5);outline-offset:-2px}
.dsh-mmd-pane[data-pannable]{cursor:grab;user-select:none}
.dsh-mmd-pane[data-dragging]{cursor:grabbing}
.dsh-mmd-pane{--dsh-mmd-min-scale:.67}
.dsh-mmd-pane[data-fit]{--dsh-mmd-min-scale:0}
.dsh-mmd-pane>svg{flex:none;width:calc(max(var(--dsh-mmd-inline-width,0px)*var(--dsh-mmd-min-scale),min(100%,var(--dsh-mmd-inline-width,100%),var(--dsh-mmd-canvas-height)*var(--dsh-mmd-inline-aspect,100)))*var(--dsh-mmd-inline-scale,1));max-width:none!important;height:auto;display:block;margin:auto}
.dsh-mmd-inline-zoom{display:flex;align-items:center;gap:2px;padding-inline-end:6px;border-inline-end:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
.dsh-mmd-pane[data-state='loading'],.dsh-mmd-pane[data-state='error'],.dsh-mmd-pane[data-state='empty']{font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888);padding:12px 4px;white-space:pre-wrap}
.dsh-mmd-pane[data-state='loading']{box-sizing:border-box;min-height:var(--dsh-mmd-canvas-height)}
.dsh-mmd-pane[data-state='error']{display:none}
.dsh-mmd-code{display:none;margin:0;padding:12px 14px;overflow-x:auto;font:var(--dsl-code-block-content-font,var(--dsw-font-markdown-code-block,13px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));color:var(--dsw-alias-label-primary,#e6e6e6);white-space:pre;tab-size:4}
.dsh-mmd-editor{display:none;min-width:0}
.dsh-mmd-textarea{box-sizing:border-box;width:100%;height:var(--dsh-mmd-canvas-height);min-height:120px;resize:vertical;margin:0;padding:10px 12px;border:0;border-radius:0;background:transparent;color:var(--dsw-alias-label-primary,#222);font:var(--dsl-code-block-content-font,var(--dsw-font-markdown-code-block,13px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));line-height:1.6;white-space:pre;overflow:auto;tab-size:4}
.dsh-mmd-textarea:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4c6ef5);outline-offset:-2px}
.dsh-mmd-draft-hint{margin-top:auto;padding:7px 12px;border-top:1px solid var(--dsh-mmd-panel-border);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary,#666)}
.dsh-mmd-notice,.dsh-mmd-error{font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888);padding:8px 14px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-mmd-notice[hidden]{display:none}
.dsh-mmd-config-warning,.dsh-mmd-viewer-status{font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-secondary,#888);padding:8px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-mmd-config-warning[hidden],.dsh-mmd-viewer-status[hidden]{display:none}
.dsh-mmd[data-view='edit'] .dsh-mmd-config-warning{flex-basis:100%;order:3}
.dsh-mmd-notice[data-tone='error'],.dsh-mmd-error{color:var(--dsw-alias-state-error-primary,#d33)}
.dsh-mmd-error:empty{display:none}
.dsh-mmd-error-details{margin:8px 14px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.dsh-mmd-error-details summary{cursor:pointer}
.dsh-mmd-error-details pre{margin:6px 0;max-height:10rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-mmd-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.dsh-mmd[data-view='code'] .dsh-mmd-body{padding:0}
.dsh-mmd[data-view='code'] .dsh-mmd-preview{display:none}
.dsh-mmd[data-view='code'] .dsh-mmd-code{display:block}
.dsh-mmd-preview:has(.dsh-mmd-pane[data-state='error']){display:none}
.dsh-mmd[data-view='edit'] .dsh-mmd-body{display:flex;flex-wrap:wrap;gap:12px}
.dsh-mmd[data-view='edit'] :is(.dsh-mmd-editor,.dsh-mmd-preview){--dsh-mmd-panel-border:var(--dsw-alias-border-l1,rgba(127,127,127,.25));display:flex;flex-direction:column;border:1px solid var(--dsh-mmd-panel-border);border-radius:6px;background:var(--dsw-alias-bg-layer-1,transparent)}
.dsh-mmd-editor{flex:1 1 300px}
.dsh-mmd[data-view='edit'] .dsh-mmd-preview{flex:1 1 264px;min-height:calc(var(--dsh-mmd-canvas-height) + 42px)}
.dsh-mmd[data-view='edit'] .dsh-mmd-panel-head{box-sizing:border-box;min-height:42px;padding:4px 8px;border-bottom:1px solid var(--dsh-mmd-panel-border);font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#666)}
.dsh-mmd[data-view='edit'] .dsh-mmd-preview-label{display:block}
.dsh-mmd[data-view='edit'] .dsh-mmd-preview-controls{margin-bottom:0;font-weight:400}
.dsh-mmd[data-view='edit'] .dsh-mmd-pane:not(:has(>svg)){padding-inline:12px}
.dsh-mmd-preview .dsh-mmd-feedback{max-height:35vh;overflow:auto}
/* 原始代码块始终隐藏：代码视图由卡片内部的 .dsh-mmd-code 呈现 */
.dsh-mmd + pre{display:none}
@media (prefers-reduced-motion:reduce){.dsh-mmd *{animation:none!important;transition:none!important}}
@media (forced-colors:active){.dsh-mmd-btn:focus-visible{outline-color:Highlight}}
`;

const VIEWER_CSS = `
/* Keep native titlebar clearance even when Desktop's fullscreen marker is stale. */
.dsh-mmd-viewer{position:fixed;z-index:2147483000;inset:0;top:max(var(--dsh-mmd-titlebar-height,0px),calc(env(titlebar-area-y,0px) + env(titlebar-area-height,0px)));-webkit-app-region:no-drag;display:flex;flex-direction:column;background:#fff;color:var(--dsw-alias-label-primary,#222)}
html[data-windows-titlebar]:not([data-fullscreen]) .dsh-mmd-viewer{--dsh-mmd-titlebar-height:var(--dsh-windows-titlebar-height,40px)}
body[data-ds-dark-theme] .dsh-mmd-viewer{background:#121212;color:var(--dsw-alias-label-primary,#f5f5f5)}
.dsh-mmd-viewer[hidden]{display:none}
.dsh-mmd-viewer-bar{display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-1,rgba(30,30,30,.98))}
.dsh-mmd-viewer-bar .dsh-mmd-btn{border-color:var(--dsw-alias-border-l1,rgba(127,127,127,.3))}
.dsh-mmd-viewer-title{margin-right:auto;font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-mmd-viewer-viewport{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none;background-color:var(--dsh-mmd-diagram-background,transparent)}
.dsh-mmd-viewer-viewport[data-dragging='true']{cursor:grabbing}
.dsh-mmd-viewer-stage{position:absolute;left:50%;top:50%;transform-origin:center;will-change:transform}
.dsh-mmd-viewer-stage svg{display:block;max-width:none;height:auto;background:transparent}
`;

// Keep the views usable while the packaged stylesheet is loading or unavailable.
const FALLBACK_CSS = `
.dsh-mmd-native-fence,.dsh-mmd-native-seat,.dsh-mmd-native-source{display:contents}
.dsh-mmd-native-seat:not(:empty)+.dsh-mmd-native-source,.dsh-mmd+pre{display:none}
.dsh-mmd-code,.dsh-mmd-editor,.dsh-mmd-preview-controls,.dsh-mmd-error:empty{display:none}
.dsh-mmd-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.dsh-mmd[data-view='code'] .dsh-mmd-preview{display:none}
.dsh-mmd[data-view='code'] .dsh-mmd-code,.dsh-mmd[data-view='edit'] .dsh-mmd-editor{display:block}
.dsh-mmd-preview:has(.dsh-mmd-pane>svg) .dsh-mmd-preview-controls{display:flex}
.dsh-mmd-pane>svg{display:block;max-width:100%;height:auto}
.dsh-mmd-textarea{box-sizing:border-box;width:100%;min-height:12em}
`;

export { CSS, FALLBACK_CSS, VIEWER_CSS };
