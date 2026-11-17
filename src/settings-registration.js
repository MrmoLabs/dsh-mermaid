const SETTINGS_REVISION = typeof __DSH_MERMAID_SETTINGS_REV__ === 'undefined' ? 'development' : __DSH_MERMAID_SETTINGS_REV__;
const SETTINGS_URL = `/dsh-mermaid/settings-runtime.js?rev=${SETTINGS_REVISION}`;

function registerNativeSettings(ctx, hostRequire) {
  if (typeof ctx.inject !== 'function' || !hostRequire) return;
  // Optional child: hosts without these public services retain diagram rendering.
  ctx.inject(['slots', 'locale', 'configForms'], (child) => {
    if (typeof child.configForms.whileServed !== 'function' || typeof child.configForms.get !== 'function' || typeof child.configForms.describe !== 'function'
      || typeof child.slots?.inject !== 'function' || typeof child.slots.register !== 'function') return;
    child.effect(() => child.configForms.whileServed(['ui-mermaid'], () => {
      let React;
      let primitives;
      try { React = hostRequire('react'); primitives = hostRequire('@deepseek-ai/dsh-client-ui-primitives'); }
      catch { return () => {}; }
      if (!React?.useSyncExternalStore || !primitives?.SettingsForm || !primitives.Button || !primitives.Input) return () => {};
      let runtime;
      let pending;
      let disposed = false;
      function Page() {
        const [page, setPage] = React.useState(() => runtime?.Page);
        const [failed, setFailed] = React.useState(false);
        React.useEffect(() => {
          let current = true;
          if (!pending) {
            pending = import(SETTINGS_URL).then((module) => {
              if (disposed) return undefined;
              runtime = module.registerSettingsRuntime({ ctx: child, React, primitives });
              return runtime;
            }).catch((error) => { pending = null; throw error; });
          }
          pending.then((result) => { if (current && result) setPage(() => result.Page); }, () => { if (current) setFailed(true); });
          return () => { current = false; };
        }, []);
        if (page) return React.createElement(page);
        const chinese = /^zh\b/i.test(child.locale.getSnapshot().active);
        return React.createElement('p', { role: 'status' }, failed
          ? (chinese ? '设置页面加载失败，请重新打开此页；仍可编辑 profile 配置。' : 'Settings could not be loaded. Reopen this page or edit the profile configuration.')
          : (chinese ? '正在加载 Mermaid 设置…' : 'Loading Mermaid settings…'));
      }
      const unregister = child.slots.inject('plugins.bundle.config', () => child.slots.register({ name: 'plugins.bundle.config', key: 'dsh-mermaid' }, Page));
      return () => { disposed = true; unregister(); runtime?.dispose(); };
    }), 'dsh-mermaid: native settings page');
  });
}

export { SETTINGS_URL, registerNativeSettings };
