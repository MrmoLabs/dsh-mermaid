import { FENCE_SELECTOR } from './fence-registration.js';

const CONVERSATION_SESSION = 'data-conversation-session';
const SESSION_SELECTOR = '[' + CONVERSATION_SESSION + ']';

function conversationSession(element) {
  return element.closest(SESSION_SELECTOR)?.getAttribute(CONVERSATION_SESSION);
}

function createDiagramDrafts() {
  const byFence = new Map();

  function key(element, session) {
    if (!session) return;
    const fence = element.closest(FENCE_SELECTOR);
    const flow = fence?.closest('[data-chat-flow-key]');
    const flowKey = flow?.getAttribute('data-chat-flow-key');
    if (!flowKey || conversationSession(flow) !== session) return;
    const index = [...flow.querySelectorAll(FENCE_SELECTOR)].indexOf(fence);
    return JSON.stringify([session, flowKey, index]);
  }

  return {
    key,
    get(key, source) {
      const record = byFence.get(key);
      return record?.source === source ? record.draft : undefined;
    },
    set(key, source, draft) {
      if (!key) return;
      byFence.delete(key);
      if (draft === source || draft.length + source.length > 120_000) return;
      if (byFence.size >= 40) byFence.delete(byFence.keys().next().value);
      byFence.set(key, { source, draft });
    },
    remove(key) { byFence.delete(key); },
  };
}

export { CONVERSATION_SESSION, conversationSession, createDiagramDrafts };
