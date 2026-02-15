import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { registerAgentTabRenderer, injectAgentThemeColors } from '@chatrave/strudel-adapter';
import { AgentApp } from './App';
import type { AgentHostContext } from './worker-client';
import './styles/agent.css';

const roots = new WeakMap<HTMLElement, Root>();

export function mountAgentUi(container: HTMLElement, hostContext?: AgentHostContext): void {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  root.render(createElement(AgentApp, { hostContext }));
}

export function unmountAgentUi(container: HTMLElement): void {
  const root = roots.get(container);
  if (!root) return;
  root.unmount();
  roots.delete(container);
}

if (typeof window !== 'undefined') {
  // Inject theme colors from Strudel theme
  injectAgentThemeColors();

  registerAgentTabRenderer({
    render: (container, context) => {
      mountAgentUi(container, context as AgentHostContext);
    },
    unmount: (container) => {
      unmountAgentUi(container);
    },
  });

  const standaloneRoot = document.querySelector<HTMLElement>('[data-agent-web-root]');
  if (standaloneRoot) {
    mountAgentUi(standaloneRoot);
  }
}
