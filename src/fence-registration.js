import { isMermaidSource } from './detection.js';

const FENCE_SLOT = 'conversation.chat.markdown.fence';
const FENCE_SELECTOR = `[data-slot="${FENCE_SLOT}"]`;
const FENCE_LANGUAGES = ['mermaid', 'mermaidjs', 'mmd'];

function registerNativeFences(ctx, hostRequire, updateCard, setActive, translate) {
  if (typeof ctx.inject !== 'function' || !hostRequire) return;
  ctx.inject(['slots'], (child) => {
    if (typeof child.slots?.inject !== 'function' || typeof child.slots.register !== 'function') return;
    let React;
    try { React = hostRequire('react'); }
    catch { return; }
    if (!React?.createElement || !React.useRef || !React.useLayoutEffect) return;

    function MermaidFence({ code, streaming, children }) {
      const seat = React.useRef(null);
      const retryButton = React.useRef(null);
      const failedAttempt = React.useRef(null);
      const [failed, setFailed] = React.useState(false);
      const [attempt, setAttempt] = React.useState(0);
      React.useLayoutEffect(() => {
        const element = seat.current;
        return () => updateCard(element, null);
      }, []);
      React.useLayoutEffect(() => {
        if (failedAttempt.current === attempt) return;
        try {
          updateCard(seat.current, code, streaming);
          setFailed(false);
          if (attempt && document.activeElement === retryButton.current) {
            seat.current.querySelector('.dsh-mmd-view-control')?.focus({ preventScroll: true });
          }
        } catch {
          updateCard(seat.current, null);
          failedAttempt.current = attempt;
          setFailed(true);
        }
      }, [code, streaming, attempt]);
      return React.createElement('div', { className: 'dsh-mmd-native-fence' },
        React.createElement('div', { className: 'dsh-mmd-native-seat', ref: seat }),
        React.createElement('div', { className: 'dsh-mmd-native-source' }, children),
        failed && React.createElement('button', {
          type: 'button', className: 'dsh-mmd-btn dsh-mmd-retry', ref: retryButton,
          onClick: () => setAttempt((value) => value + 1),
        }, translate('retryRender')));
    }

    child.effect(() => child.slots.inject(FENCE_SLOT, () => {
      const disposers = [];
      try {
        // The host also dispatches unlabelled fences through the same outlet.
        // The specific layers below replace this wildcard for explicit Mermaid.
        disposers.push(child.slots.register({ name: FENCE_SLOT, id: 'dsh-mermaid/fence' },
          (props) => !props.lang && isMermaidSource(props.code)
            ? React.createElement(MermaidFence, props) : props.children));
        for (const key of FENCE_LANGUAGES) {
          disposers.push(child.slots.register({ name: FENCE_SLOT, key, id: 'dsh-mermaid/fence' }, MermaidFence));
        }
        setActive(true);
      } catch (error) {
        for (const dispose of disposers) dispose();
        throw error;
      }
      return () => {
        setActive(false);
        for (const dispose of disposers) dispose();
      };
    }), 'dsh-mermaid: native Markdown fences');
  });
}

export { FENCE_SELECTOR, registerNativeFences };
