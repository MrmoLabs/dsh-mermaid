// The card contains and clips its absolutely positioned live status during scrolling.
const CSS = `
.dsh-mmd{position:relative;margin:8px 0 10px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));overflow:hidden}
.dsh-mmd-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-1,transparent)}
.dsh-mmd-badge{margin-right:auto;font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888);padding:0 6px}
.dsh-mmd-btn{appearance:none;min-width:28px;min-height:28px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:transparent;color:var(--dsw-alias-label-secondary,#666);border-radius:5px;font:12px/20px inherit;padding:2px 10px;cursor:pointer}
.dsh-mmd-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}
.dsh-mmd-btn:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4c6ef5);outline-offset:2px}
.dsh-mmd-btn[aria-pressed='true']{border-color:var(--dsw-alias-button-primary-fill,#4c6ef5);color:var(--dsw-alias-button-primary-fill,#4c6ef5);background:var(--dsw-alias-interactive-bg-active,rgba(76,110,245,.12))}
.dsh-mmd-btn:disabled{opacity:.45;cursor:not-allowed}
.dsh-mmd-btn:disabled:hover{background:transparent}
.dsh-mmd-action-slot{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px}
.dsh-mmd-body{padding:10px 12px;overflow-x:auto}
.dsh-mmd-pane{display:block}
.dsh-mmd-pane svg{max-width:100%;height:auto;display:block;margin:0 auto}
.dsh-mmd-pane[data-state='loading'],.dsh-mmd-pane[data-state='error'],.dsh-mmd-pane[data-state='empty']{font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888);padding:12px 4px;white-space:pre-wrap}
.dsh-mmd-pane[data-state='error']{color:var(--dsw-alias-state-error-primary,#d33)}
.dsh-mmd-code{display:none;margin:0;padding:12px 14px;overflow-x:auto;font:var(--dsl-code-block-content-font,var(--dsw-font-markdown-code-block,13px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));color:var(--dsw-alias-label-primary,#e6e6e6);white-space:pre;tab-size:4}
.dsh-mmd-editor{display:none;flex-direction:column;gap:8px;min-width:0}
.dsh-mmd-textarea{box-sizing:border-box;width:100%;min-height:220px;resize:vertical;margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));border-radius:6px;background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,#222);font:var(--dsl-code-block-content-font,var(--dsw-font-markdown-code-block,13px/1.7 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace));line-height:1.6;white-space:pre;overflow:auto;tab-size:4}
.dsh-mmd-textarea:focus-visible{outline:2px solid var(--dsw-alias-button-primary-fill,#4c6ef5);outline-offset:2px}
.dsh-mmd-editor-footer{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:8px}
.dsh-mmd-draft-hint{flex:1 1 220px;font:11px/16px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888)}
.dsh-mmd-reset{min-height:24px;padding:1px 8px;font-size:11px}
.dsh-mmd-notice{font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-tertiary,#888);padding:8px 14px 0;white-space:pre-wrap}
.dsh-mmd-notice[hidden]{display:none}
.dsh-mmd-notice[data-tone='error']{color:var(--dsw-alias-state-error-primary,#d33)}
.dsh-mmd-error{display:none;font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-state-error-primary,#d33);padding:8px 14px 0;white-space:pre-wrap}
.dsh-mmd-error:empty{display:none}
.dsh-mmd-sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
.dsh-mmd[data-view='code'] .dsh-mmd-body{padding:0}
.dsh-mmd[data-view='code'] .dsh-mmd-pane{display:none}
.dsh-mmd[data-view='code'] .dsh-mmd-code{display:block}
.dsh-mmd[data-view='code'][data-state='error'] .dsh-mmd-error{display:block}
.dsh-mmd[data-view='edit'] .dsh-mmd-body{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px;padding:10px 12px;overflow:visible}
.dsh-mmd[data-view='edit'] .dsh-mmd-pane{display:block;flex:1 1 320px;min-width:0;order:2}
.dsh-mmd[data-view='edit'] .dsh-mmd-code{display:none}
.dsh-mmd[data-view='edit'] .dsh-mmd-editor{display:flex;flex:1 1 320px;order:1}
.dsh-mmd[data-view='edit'] .dsh-mmd-notice,.dsh-mmd[data-view='edit'] .dsh-mmd-error{flex-basis:100%;order:3}
.dsh-mmd[data-view='edit'][data-state='error'] .dsh-mmd-error:not(:empty){display:block}
@media (max-width:720px){.dsh-mmd[data-view='edit'] .dsh-mmd-pane,.dsh-mmd[data-view='edit'] .dsh-mmd-editor{flex-basis:100%}}
/* Keep native titlebar clearance even when Desktop's fullscreen marker is stale. */
.dsh-mmd-viewer{position:fixed;z-index:2147483000;inset:0;top:max(var(--dsh-mmd-titlebar-height,0px),calc(env(titlebar-area-y,0px) + env(titlebar-area-height,0px)));-webkit-app-region:no-drag;display:flex;flex-direction:column;background:#fff;color:var(--dsw-alias-label-primary,#222)}
html[data-windows-titlebar]:not([data-fullscreen]) .dsh-mmd-viewer{--dsh-mmd-titlebar-height:var(--dsh-windows-titlebar-height,40px)}
body[data-ds-dark-theme] .dsh-mmd-viewer{background:#121212;color:var(--dsw-alias-label-primary,#f5f5f5)}
.dsh-mmd-viewer[hidden]{display:none}
.dsh-mmd-viewer-bar{display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-1,rgba(30,30,30,.98))}
.dsh-mmd-viewer-title{margin-right:auto;font:12px/20px var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-secondary,#bbb)}
.dsh-mmd-viewer-viewport{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;touch-action:none}
.dsh-mmd-viewer-viewport[data-dragging='true']{cursor:grabbing}
.dsh-mmd-viewer-stage{position:absolute;left:50%;top:50%;transform-origin:center;will-change:transform}
.dsh-mmd-viewer-stage svg{display:block;max-width:none;height:auto;background:transparent}
/* 原始代码块始终隐藏：代码视图由卡片内部的 .dsh-mmd-code 呈现 */
.dsh-mmd + pre{display:none}
@media (prefers-reduced-motion:reduce){.dsh-mmd *{animation:none!important;transition:none!important}}
@media (forced-colors:active){.dsh-mmd-btn:focus-visible{outline-color:Highlight}}
`;

export { CSS };
