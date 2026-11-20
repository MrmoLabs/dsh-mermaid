import { isMermaidSource } from './detection.js';

const FENCE_SLOT = 'conversation.chat.markdown.fence';
const FENCE_SELECTOR = `[data-slot="${FENCE_SLOT}"]`;
const FENCE_LANGUAGES = ['mermaid', 'mermaidjs', 'mmd'];

function registerNativeFences(ctx, hostRequire, updateCard, setActive) {
  if (typeof ctx.inject !== 'function' || !hostRequire) return;
  ctx.inject(['slots'], (child) => {
    if (typeof child.slots?.inject !== 'function' || typeof child.slots.register !== 'function') return;
    let React;
    try { React = hostRequire('react'); }
    catch { return; }
    if (!React?.createElement || !React.useRef || !React.useLayoutEffect) return;

    function MermaidFence({ code, streaming, children }) {
      const seat = React.useRef(null);
      React.useLayoutEffect(() => {
        const element = seat.current;
        return () => updateCard(element, null);
      }, []);
      React.useLayoutEffect(() => {
        updateCard(seat.current, code, streaming);
      }, [code, streaming]);
      return React.createElement('div', { className: 'dsh-mmd-native-fence' },
        React.createElement('div', { className: 'dsh-mmd-native-seat', ref: seat }),
        React.createElement('div', { className: 'dsh-mmd-native-source' }, children));
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
