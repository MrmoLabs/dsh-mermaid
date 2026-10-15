# dsh-mermaid

简体中文 | [English](README.md)

在 DeepSeek Harness Web 会话中把 Mermaid 围栏代码块渲染为 SVG 图形，并提供**代码 / 图形**双向切换。插件支持流式输出、深色主题、全屏查看、缩放与拖拽、SVG 导出，并在渲染失败时自动回退到源代码。

[![npm version](https://img.shields.io/npm/v/dsh-mermaid.svg)](https://www.npmjs.com/package/dsh-mermaid)

## 功能特性

- 支持 `mermaid`、`mermaidjs` 和 `mmd` 围栏代码块
- 兼容 DSH/Shiki plain fallback，此时代码元素可能没有 language class
- 固定并打包 Mermaid `11.17.0`，运行时不依赖 CDN
- 仅在首次检测到 Mermaid 代码块后，才从 DSH 同源加载已打包的 Mermaid 运行时
- 多图通过串行队列逐个渲染，并在图形之间让出主线程，降低页面卡顿
- 使用 Mermaid `securityLevel: strict`
- 抑制 Mermaid 内置的解析错误 SVG，使渲染失败时干净地回退源码，不在页面中遗留临时错误图
- 支持全屏查看，并提供缩放、拖拽、恢复 100% 和适应窗口操作
- 全屏查看时把键盘焦点限制在对话框内、隔离背景内容，并在关闭后把焦点还给触发按钮
- 向辅助技术播报渲染与下载状态，并为生成的 SVG 图形提供可访问名称
- 可直接通过卡片按钮把已渲染图形导出为独立 SVG 文件
- 在代码和图形视图中始终提供全屏与 SVG 下载操作，并在切换时保持工具栏位置稳定
- 根据页面和浏览器语言自动使用简体中文或英文界面及状态文案
- 只增强 `<pre><code>` 代码块，不处理行内代码
- 防止旧的异步渲染结果覆盖较新的流式内容
- 单图超过 50,000 字符或 2,000 行时，在调用 Mermaid 前拒绝渲染并回退源码

## 兼容性

最后验证环境为 2026-09-05 的 `@deepseek-ai/dsh 0.1.2-rc.1` 与 Node.js 22.23.2。DSH 当前仍处于开发预览阶段，后续版本可能包含破坏性兼容变化；如果新版 DSH 调整了插件加载器或 Markdown DOM，请提交 issue。

### 运行时与集成边界

Mermaid 运行时在 DSH Web 浏览器或 Desktop 渲染进程中执行，这些环境具有 `window` 和 `document`。Node.js 宿主通过 HTTP 提供打包文件。Node.js 版本要求适用于安装、构建和插件宿主；本项目目前未提供受支持的 Node.js 校验 API。

`lib/mermaid-runtime.js` 是内部浏览器 bundle，随包发布是为了供插件的同源运行时路由使用，并非公开的包导出。通过解析 `dsh-mermaid/package.json` 再拼接路径访问此文件，会依赖可能变化的内部打包结构。

尝试在服务端复用解析器时，需要处理以下条件：

- 部分图类型在 `parse()` 阶段就会通过 DOMPurify 清洗标签。缺少 DOM 时，合法的带标签 flowchart 和状态图也可能抛出 `addHook is not a function` 或 `sanitize is not a function`。某个时序图解析通过，不能证明其他输入也兼容。
- 在**首次导入运行时之前**提供兼容 DOM，建议放在独立 worker 或进程中。DOMPurify 会在初始化时捕获环境；导入后补 DOM 无法修复已缓存的模块。在异步导入期间临时修改全局变量，也可能被宿主的其他代码观察到。选择 DOM 实现时请参考 [DOMPurify 服务端说明](https://github.com/cure53/DOMPurify#running-dompurify-on-the-server)。
- Windows 上将绝对文件路径传入动态 `import()` 前，需要使用 `pathToFileURL(runtimePath).href` 转为文件 URL。
- 区分输入无效与依赖不可用、环境故障、超时等失败。Mermaid 错误的 `.hash` 字段不是通用分类依据：错误的 pie 语法、未知图类型也可能不带该字段。校验未完成时不能报告通过。
- 使用与渲染端一致的 Mermaid 版本及相关配置。`parse()` 通过仅表示语法检查通过，不能保证布局或 SVG 渲染成功；渲染端仍需保留错误处理和源码回退。

## 安装

如果已经全局安装 `dsh`，通过 npm 稳定版安装：

```powershell
dsh plugin --profile web add -w dsh-mermaid
```

如果没有全局 `dsh` 命令，可以通过 npx 调用 DSH：

```powershell
npx.cmd --yes @deepseek-ai/dsh plugin --profile web add -w dsh-mermaid
```

DSH 会通过 pnpm 安装包、识别其中的 `dsh.bundle` 声明，并自动把 `dsh-mermaid` 加入 web profile 的 bundles。安装完成后重启 DSH Web 或刷新页面。

### 安装 GitHub 最新源码版

```powershell
npx.cmd -y github:MrmoLabs/dsh-mermaid install
```

该命令会运行仓库提供的 `dsh-mermaid` 安装器，再让 DSH 把 GitHub 源安装到 web profile。GitHub 源会在安装阶段构建。如果 pnpm 提示阻止了 build script，请把它输出的精确包名加入 profile 的 `pnpm-workspace.yaml` `allowBuilds`，然后重新执行命令。普通用户建议优先使用 npm 稳定版。

安装到 DSH Desktop 时，在安装器命令后添加 `--profile desktop`。安装器自身的帮助、错误和完成提示支持英文与简体中文。它依次读取 `DSH_MERMAID_LANG`、`DSH_LANG`、`LC_ALL`、`LC_MESSAGES`、`LANG`、`LANGUAGE`，然后使用系统语言；`C`、`POSIX` 等不指定自然语言的区域值会被跳过。可设置 `DSH_MERMAID_LANG=en` 或 `DSH_MERMAID_LANG=zh-CN` 覆盖。此设置不会改变 DSH 或 pnpm 输出的文案。

## 更新和卸载

更新 npm 稳定版：

```powershell
dsh plugin --profile web update -w dsh-mermaid
```

卸载：

```powershell
dsh plugin --profile web remove -w dsh-mermaid
```

更新或卸载后请重启 DSH Web。

## 使用方法

让模型输出 Mermaid 围栏代码块：

````markdown
```mermaid
flowchart LR
  A[代码] --> B[图形]
```
````

代码块上方会出现**代码 / 图形**按钮，默认显示图形。

## 从源码开发

需要 Node.js 22.19 或更高版本。

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run build
dsh plugin --profile web add -w .
```

构建产物位于 `lib/`。轻量的 `client.js` 启动器由 DSH 客户端模块加载器注册为 `dsh-mermaid`，打包后的 Mermaid 运行时则通过插件的同源宿主路由按需加载。DSH 会以当前插件项目为基准解析相对安装路径。

`npm.cmd run check` 除客户端测试外，还会构建运行时，并在独立进程中分别验证有 DOM、无 DOM 时真实解析器的行为。提供 DOM 的解析测试使用 happy-dom 作为测试环境，不验证浏览器布局或 SVG 渲染效果，也不代表推荐将其用作生产服务端 DOM 实现。

本地开发时，也可以手动把构建后的包复制到：

```text
C:\Users\<用户名>\.dsh\profiles\web\node_modules\dsh-mermaid
```

不要把整个 `.dsh` 目录提交到 Git，其中可能包含会话和凭据。

## 发布检查

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd pack --dry-run
git status --short
git diff --cached
```

## 许可证

[MIT](LICENSE)
