export interface AgentTabHostContext {
  started?: boolean;
}

export interface AgentTabRenderer {
  render: (container: HTMLElement, context: AgentTabHostContext) => void;
  unmount?: (container: HTMLElement) => void;
}

declare global {
  interface Window {
    __CHATRAVE_AGENT_TAB_RENDERER__?: AgentTabRenderer;
  }
}

let mountedContainer: HTMLElement | null = null;

export function registerAgentTabRenderer(renderer: AgentTabRenderer): void {
  window.__CHATRAVE_AGENT_TAB_RENDERER__ = renderer;
}

export function mountAgentTab(container: HTMLElement, context: AgentTabHostContext): void {
  const renderer = window.__CHATRAVE_AGENT_TAB_RENDERER__;
  if (!renderer) {
    container.textContent = 'Agent tab renderer unavailable';
    return;
  }

  if (mountedContainer && mountedContainer !== container && renderer.unmount) {
    renderer.unmount(mountedContainer);
  }

  mountedContainer = container;
  renderer.render(container, context);
}

export function unmountAgentTab(): void {
  const renderer = window.__CHATRAVE_AGENT_TAB_RENDERER__;
  if (!renderer || !mountedContainer || !renderer.unmount) {
    return;
  }

  renderer.unmount(mountedContainer);
  mountedContainer = null;
}
