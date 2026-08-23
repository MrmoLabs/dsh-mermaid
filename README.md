# dsh-mermaid

在 DeepSeek Harness Web 会话中把 Mermaid 围栏代码块渲染为 SVG 图形，并提供“图 / 代码”双向切换。支持流式输出、深色主题和渲染失败后自动回退到代码。

## 特性

- 支持 `mermaid`、`mermaidjs`、`mmd` 围栏代码块
- 兼容 DSH/Shiki plain fallback（代码元素可能没有 language class）
- Mermaid 固定为 `11.17.0` 并打入客户端产物，不依赖运行时 CDN
- 使用 Mermaid `securityLevel: strict`
- 只增强 `<pre><code>` 代码块，不处理行内代码
- 使用渲染 generation 防止流式输出中的旧结果覆盖新结果

## 开发与验证

要求 Node.js 22.19 或更高版本。

```powershell
npm.cmd install
npm.cmd run check
npm.cmd run build
```

构建产物位于 `lib/`，并由 DSH 客户端模块加载器注册为 `dsh-mermaid`。

## 安装到 DSH Web Profile

在插件项目目录完成构建后，将包安装到 web profile，并确保 profile 的 `dsh.profile.bundles` 包含 `dsh-mermaid`。具体安装命令可能随 DSH 版本变化，请以当前 DSH 插件管理命令为准。

本地开发时，也可以把整个项目复制到：

```text
C:\Users\<用户名>\.dsh\profiles\web\node_modules\dsh-mermaid
```

然后重启或强制刷新 DSH Web 页面。不要把整个 `.dsh` 目录提交到 Git，其中可能包含会话和凭据。

## 使用

让模型输出：

````markdown
```mermaid
flowchart LR
  A[代码] --> B[图形]
```
````

代码块上方会出现“图 / 代码”按钮，默认显示图形。

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
