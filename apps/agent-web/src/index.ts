import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type RunnerEvent } from '@chatrave/shared-types';
import { loadSettings, saveSettings } from '@chatrave/storage-local';
import { registerAgentTabRenderer } from '@chatrave/strudel-adapter';
import { createRunnerWorkerClient, type AgentHostContext } from './worker-client';
import {
  buildScenariosUrl,
  clearMockRuntimeOverrides,
  enableMockRuntimeDefaults,
  isDevFakeUiEnabled,
  readRuntimeOverrides,
  readRuntimeScenario,
  writeDevFakeUiEnabled,
  writeRuntimeScenario,
} from './runtime-overrides';
import { formatJsonBlock, renderMarkdownLike, type ToolLogPayload } from './ui-helpers';
import { clearChatSession, loadChatSession, saveChatSession } from './chat-session-store';
import './styles/agent.css';

type ToolLogView = ToolLogPayload & { expanded: boolean };
type PopoverKind = 'settings' | 'dev' | null;
const EMPTY_HINT_CHIPS = [
  'Give me a techno beat',
  'Add a bassline layer',
  'Make it more minimal',
  'Explain this pattern',
];

interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingContent?: string;
  thinkingStreaming?: boolean;
  thinkingExpanded?: boolean;
  thinkingManuallyCollapsed?: boolean;
  createdAt: number;
  streaming?: boolean;
  failedReason?: string;
  cookedLabel?: string;
  sourceUserText?: string;
  toolLogs: ToolLogView[];
}

interface UiState {
  messages: ChatMessageView[];
  runningTurnId: string | null;
  pinnedToBottom: boolean;
  showJumpToLatest: boolean;
  isComposing: boolean;
  openPopover: PopoverKind;
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function isJamPrompt(text: string): boolean {
  return /\b(beat|techno|house|drum|groove|bass|pattern|jam|music|kick|snare|hihat|hh|bd)\b/i.test(text);
}

function isHostStarted(hostContext?: AgentHostContext): boolean {
  if (hostContext?.started) {
    return true;
  }
  try {
    const started = (window as Window & { strudelMirror?: { repl?: { state?: { started?: boolean } } } }).strudelMirror?.repl
      ?.state?.started;
    return Boolean(started);
  } catch {
    return false;
  }
}

function startPlaybackFromUserGesture(hostContext?: AgentHostContext): void {
  hostContext?.handleTogglePlay?.();
  if (isHostStarted(hostContext)) {
    return;
  }
  try {
    const repl = (window as Window & { strudelMirror?: { repl?: { start?: () => void; toggle?: () => void } } }).strudelMirror
      ?.repl;
    repl?.start?.();
    repl?.toggle?.();
  } catch {
    // fall through to button click fallback
  }
  if (isHostStarted(hostContext)) {
    return;
  }
  const playButton = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim().toLowerCase() === 'play' || button.textContent?.trim() === '...',
  );
  if (playButton instanceof HTMLButtonElement) {
    playButton.click();
  }
}

function pulseEditorBorder(status: 'scheduled' | 'applied' | 'rejected'): void {
  const editorRoot = document.querySelector('.cm-editor') as HTMLElement | null;
  if (!editorRoot) {
    return;
  }

  const color = status === 'rejected' ? '#ff4d4f' : '#52c41a';
  const previousTransition = editorRoot.style.transition;
  const previousBoxShadow = editorRoot.style.boxShadow;
  editorRoot.style.transition = 'box-shadow 120ms ease-in-out';
  editorRoot.style.boxShadow = `0 0 0 2px ${color}, 0 0 12px ${color}`;
  window.setTimeout(() => {
    editorRoot.style.boxShadow = previousBoxShadow;
    editorRoot.style.transition = previousTransition;
  }, 700);
}

function createLabeledInput(labelText: string, input: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'agent-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  wrapper.append(label, input);
  return wrapper;
}

function findLastAssistant(messages: ChatMessageView[]): ChatMessageView | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      return messages[i];
    }
  }
  return undefined;
}

function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

function summarizeThinking(content?: string): string {
  const value = (content ?? '').replace(/\s+/g, ' ').trim();
  if (!value) {
    return '';
  }
  if (value.length <= 56) {
    return value;
  }
  return `${value.slice(-56)}...`;
}

function stripPseudoToolTags(input: string): string {
  return input
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
    .replace(/<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g, '')
    .replace(/<\|tool_call(?:s)?_[^|]+?\|>/g, '')
    .trim();
}

function setIconLabel(target: HTMLElement, icon: string, label: string): void {
  target.innerHTML = '';
  const iconNode = document.createElement('span');
  iconNode.className = 'agent-icon';
  iconNode.setAttribute('aria-hidden', 'true');
  iconNode.textContent = icon;
  const labelNode = document.createElement('span');
  labelNode.className = 'agent-label';
  labelNode.textContent = label;
  target.append(iconNode, labelNode);
}

export function mountAgentUi(container: HTMLElement, hostContext?: AgentHostContext): void {
  const persistedSession = loadChatSession();
  let settings = loadSettings();
  let worker = createRunnerWorkerClient(settings, hostContext);
  let unsubscribeWorker: (() => void) | null = null;
  let runtimeOverrides = readRuntimeOverrides();
  let lastUserTextForTurn = '';
  let activeAssistantIdByTurn = new Map<string, string>();
  let pendingLogsByTurn = new Map<string, ToolLogView[]>();

  const state: UiState = {
    messages: persistedSession.messages.map((message) => ({
      ...message,
      toolLogs: (message.toolLogs ?? []).map((log) => ({ ...log, expanded: Boolean(log.expanded) })),
      thinkingExpanded: Boolean(message.thinkingExpanded),
      thinkingManuallyCollapsed: Boolean(message.thinkingManuallyCollapsed),
      thinkingStreaming: false,
    })),
    runningTurnId: null,
    pinnedToBottom: true,
    showJumpToLatest: false,
    isComposing: false,
    openPopover: null,
  };

  const root = document.createElement('div');
  root.className = 'agent-root';

  const header = document.createElement('div');
  header.className = 'agent-header';

  const title = document.createElement('div');
  title.className = 'agent-title';
  setIconLabel(title, '◈', 'Jam Agent');

  const headerButtons = document.createElement('div');
  headerButtons.className = 'agent-header-buttons';

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'agent-header-button danger';
  setIconLabel(clearButton, '✕', 'Clear');

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'agent-header-button';
  setIconLabel(settingsButton, '⚙', 'Settings');
  settingsButton.setAttribute('data-testid', 'settings-button');

  const devButton = document.createElement('button');
  devButton.type = 'button';
  devButton.className = 'agent-header-button';
  setIconLabel(devButton, '⌘', 'Dev');
  devButton.setAttribute('data-testid', 'dev-button');

  headerButtons.append(clearButton, settingsButton, devButton);
  header.append(title, headerButtons);

  const overlayLayer = document.createElement('div');
  overlayLayer.className = 'agent-popovers';

  const settingsPopover = document.createElement('div');
  settingsPopover.className = 'agent-popover';
  settingsPopover.setAttribute('data-testid', 'settings-popover');
  const settingsTitle = document.createElement('div');
  settingsTitle.className = 'agent-popover-title';
  settingsTitle.textContent = 'Settings';

  const modelInput = document.createElement('input');
  modelInput.value = settings.model;

  const tempInput = document.createElement('input');
  tempInput.type = 'number';
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  tempInput.value = String(settings.temperature);

  const apiKeyInput = document.createElement('input');
  apiKeyInput.type = 'password';
  apiKeyInput.value = settings.apiKey;

  const mode = document.createElement('select');
  for (const option of ['fast', 'balanced', 'deep'] as const) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = option;
    if (option === settings.reasoningMode) {
      item.selected = true;
    }
    mode.append(item);
  }

  const settingsGrid = document.createElement('div');
  settingsGrid.className = 'agent-grid';
  settingsGrid.append(
    createLabeledInput('Model', modelInput),
    createLabeledInput('Reasoning mode', mode),
    createLabeledInput('Temperature', tempInput),
    createLabeledInput('API key', apiKeyInput),
  );
  settingsPopover.append(settingsTitle, settingsGrid);

  const devPopover = document.createElement('div');
  devPopover.className = 'agent-popover';
  devPopover.setAttribute('data-testid', 'dev-popover');
  const devTitle = document.createElement('div');
  devTitle.className = 'agent-popover-title';
  devTitle.textContent = 'Dev Controls';

  const devToggle = document.createElement('input');
  devToggle.type = 'checkbox';
  devToggle.checked = isDevFakeUiEnabled();
  const devToggleLabel = createLabeledInput('Enable mock LLM', devToggle);

  const devScenarioSelect = document.createElement('select');
  const devScenarioLabel = createLabeledInput('Mock scenario', devScenarioSelect);
  const devScenarioStatus = document.createElement('div');
  devScenarioStatus.className = 'agent-hint';
  devScenarioLabel.append(devScenarioStatus);

  const devKnowledgeQuery = document.createElement('input');
  devKnowledgeQuery.type = 'text';
  devKnowledgeQuery.placeholder = 'e.g. room, cp, euclid, setcpm';
  const devKnowledgeDomain = document.createElement('select');
  for (const option of ['auto', 'reference', 'sounds'] as const) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = option;
    devKnowledgeDomain.append(item);
  }
  const runDevKnowledge = document.createElement('button');
  runDevKnowledge.type = 'button';
  runDevKnowledge.className = 'agent-secondary';
  setIconLabel(runDevKnowledge, '⌕', 'Run knowledge');
  const devKnowledgeStatus = document.createElement('div');
  devKnowledgeStatus.className = 'agent-hint';
  devKnowledgeStatus.textContent = 'Runs local strudel_knowledge directly (no LLM call).';

  const knowledgeWrap = document.createElement('div');
  knowledgeWrap.className = 'agent-grid';
  knowledgeWrap.append(
    createLabeledInput('Knowledge query', devKnowledgeQuery),
    createLabeledInput('Knowledge domain', devKnowledgeDomain),
  );
  devPopover.append(devTitle, devToggleLabel, devScenarioLabel, knowledgeWrap, runDevKnowledge, devKnowledgeStatus);

  overlayLayer.append(settingsPopover, devPopover);

  const feed = document.createElement('div');
  feed.className = 'agent-feed';
  feed.setAttribute('data-testid', 'chat-feed');

  const jumpWrap = document.createElement('div');
  jumpWrap.className = 'agent-jump-wrap';
  const jumpButton = document.createElement('button');
  jumpButton.type = 'button';
  jumpButton.className = 'agent-secondary agent-jump';
  setIconLabel(jumpButton, '↓', 'Jump to latest');
  jumpButton.onclick = () => {
    state.pinnedToBottom = true;
    state.showJumpToLatest = false;
    maybeScrollToBottom(true);
    renderMessages();
  };
  jumpWrap.append(jumpButton);

  const composerWrap = document.createElement('div');
  composerWrap.className = 'agent-composer';

  const composer = document.createElement('textarea');
  composer.className = 'agent-textarea';
  composer.placeholder = 'Ask the jam agent...';

  const composerRow = document.createElement('div');
  composerRow.className = 'agent-composer-row';

  const hint = document.createElement('div');
  hint.className = 'agent-hint';
  hint.textContent = 'Enter to send, Shift+Enter for newline.';

  const primaryButton = document.createElement('button');
  primaryButton.type = 'button';
  primaryButton.className = 'agent-primary';

  composerRow.append(hint, primaryButton);
  composerWrap.append(composer, composerRow);

  root.append(header, overlayLayer, feed, jumpWrap, composerWrap);
  container.innerHTML = '';
  container.append(root);

  function refreshPopoverVisibility(): void {
    const settingsOpen = state.openPopover === 'settings';
    const devOpen = state.openPopover === 'dev';
    settingsPopover.classList.toggle('open', settingsOpen);
    devPopover.classList.toggle('open', devOpen);
    settingsButton.setAttribute('aria-expanded', String(settingsOpen));
    devButton.setAttribute('aria-expanded', String(devOpen));
  }

  function togglePopover(kind: Exclude<PopoverKind, null>): void {
    state.openPopover = state.openPopover === kind ? null : kind;
    refreshPopoverVisibility();
  }

  function refreshPrimaryButtonState(): void {
    const hasDraft = composer.value.trim().length > 0;
    if (state.runningTurnId) {
      setIconLabel(primaryButton, '■', 'Stop');
      primaryButton.disabled = false;
      return;
    }
    setIconLabel(primaryButton, '➤', 'Send');
    primaryButton.disabled = !hasDraft;
  }

  function maybeScrollToBottom(force = false): void {
    if (force || state.pinnedToBottom) {
      requestAnimationFrame(() => {
        feed.scrollTop = feed.scrollHeight;
      });
    }
  }

  function markNewContentArrived(): void {
    if (!state.pinnedToBottom) {
      state.showJumpToLatest = true;
      jumpWrap.style.display = 'flex';
    }
  }

  function renderMessages(): void {
    saveChatSession({ messages: state.messages });
    feed.innerHTML = '';

    if (state.messages.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'agent-empty-state';

      const empty = document.createElement('div');
      empty.className = 'agent-empty';
      empty.textContent = 'Agent ready.';
      emptyState.append(empty);

      const chips = document.createElement('div');
      chips.className = 'agent-empty-chips';
      for (const label of EMPTY_HINT_CHIPS) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'agent-chip';
        chip.textContent = label;
        chip.onclick = () => {
          composer.value = label;
          composer.focus();
          refreshPrimaryButtonState();
        };
        chips.append(chip);
      }
      emptyState.append(chips);
      feed.append(emptyState);
    }

    for (const message of state.messages) {
      const row = document.createElement('div');
      row.className = `agent-row ${message.role}`;
      const stack = document.createElement('div');
      stack.className = 'agent-message-stack';

      const card = document.createElement('article');
      card.className = `agent-message ${message.role}`;

      const header = document.createElement('div');
      header.className = 'agent-message-header';

      const role = document.createElement('div');
      role.className = 'agent-role';
      role.textContent = message.role;

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.alignItems = 'center';
      right.style.gap = '8px';

      const badge = document.createElement('div');
      badge.className = 'agent-badge';
      if (message.streaming) {
        badge.textContent = 'streaming';
      }
      right.append(badge);

      if (message.role === 'assistant') {
        // Keep header compact; action buttons are rendered below the message body.
      }

      header.append(role, right);
      card.append(header);

      if (message.role === 'assistant' && (message.thinkingContent || message.thinkingStreaming)) {
        const details = document.createElement('details');
        details.className = 'agent-thinking';
        details.open = message.thinkingStreaming
          ? !message.thinkingManuallyCollapsed
          : Boolean(message.thinkingExpanded);
        details.ontoggle = () => {
          if (message.thinkingStreaming) {
            message.thinkingManuallyCollapsed = !details.open;
            message.thinkingExpanded = details.open;
            return;
          }
          message.thinkingExpanded = details.open;
          if (details.open) {
            message.thinkingManuallyCollapsed = false;
          }
        };

        const summary = document.createElement('summary');
        summary.className = 'agent-thinking-summary';
        const preview = summarizeThinking(message.thinkingContent);
        const thinkingText =
          message.thinkingStreaming && preview
            ? `Thinking… ${preview}`
            : message.thinkingStreaming
              ? 'Thinking…'
              : 'Thinking';
        summary.textContent = message.cookedLabel && !message.thinkingStreaming
          ? `${thinkingText} · ${message.cookedLabel}`
          : thinkingText;

        const body = document.createElement('pre');
        body.className = 'agent-thinking-body';
        body.textContent = message.thinkingContent || '';

        details.append(summary, body);
        card.append(details);
      }

      if (message.toolLogs.length > 0) {
        for (const log of message.toolLogs) {
          const details = document.createElement('details');
          details.className = 'agent-tool-log';
          details.open = log.expanded;
          details.setAttribute('data-testid', 'tool-log');
          details.ontoggle = () => {
            log.expanded = details.open;
          };

          const summary = document.createElement('summary');
          summary.className = 'agent-tool-summary';
          const left = document.createElement('span');
          const statusIcon = log.status === 'succeeded' ? '✓' : '!';
          left.textContent = `${statusIcon} ${log.name} · `;
          const status = document.createElement('span');
          status.className = `agent-tool-status ${log.status}`;
          status.textContent = log.status;
          left.append(status);
          const rightMeta = document.createElement('span');
          rightMeta.textContent = `${Math.max(0, log.durationMs)}ms`;
          summary.append(left, rightMeta);

          const requestPre = document.createElement('pre');
          requestPre.textContent = `[Tool Request]\n${formatJsonBlock(log.request ?? null)}`;
          const responsePre = document.createElement('pre');
          responsePre.textContent = `[Tool Response]\n${formatJsonBlock(log.response ?? null)}${log.errorMessage ? `\n[Tool Error]\n${log.errorMessage}` : ''}`;

          const actions = document.createElement('div');
          actions.className = 'agent-tool-actions';

          const copyIn = document.createElement('button');
          copyIn.type = 'button';
          copyIn.className = 'agent-quiet-button';
          setIconLabel(copyIn, '⧉', 'Copy request');
          copyIn.onclick = async () => {
            await copyText(formatJsonBlock(log.request ?? null));
          };

          const copyOut = document.createElement('button');
          copyOut.type = 'button';
          copyOut.className = 'agent-quiet-button';
          setIconLabel(copyOut, '⧉', 'Copy response');
          copyOut.onclick = async () => {
            await copyText(formatJsonBlock(log.response ?? null));
          };

          actions.append(copyIn, copyOut);

          if (log.status === 'failed' && message.sourceUserText) {
            const retryTurn = document.createElement('button');
            retryTurn.type = 'button';
            retryTurn.className = 'agent-secondary';
            setIconLabel(retryTurn, '↻', 'Retry turn');
            retryTurn.onclick = () => {
              if (state.runningTurnId) {
                return;
              }
              lastUserTextForTurn = message.sourceUserText || '';
              worker.send(lastUserTextForTurn);
            };
            actions.append(retryTurn);
          }

          details.append(summary, actions, requestPre, responsePre);
          card.append(details);
        }
      }

      const body = document.createElement('div');
      body.className = 'agent-body';
      if (message.role === 'assistant') {
        renderMarkdownLike(body, message.content || '');
      } else {
        body.textContent = message.content;
      }
      card.append(body);

      if (message.role === 'assistant' && message.cookedLabel) {
        const cooked = document.createElement('div');
        cooked.className = 'agent-hint';
        cooked.textContent = message.cookedLabel;
        card.append(cooked);
      }

      let externalActions: HTMLDivElement | null = null;
      if (message.role === 'assistant') {
        const actions = document.createElement('div');
        actions.className = 'agent-actions-bottom';

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'agent-mini-icon-button';
        copyButton.textContent = '⧉';
        copyButton.setAttribute('aria-label', 'Copy');
        copyButton.title = 'Copy';
        copyButton.onclick = async () => {
          await copyText(message.content);
          copyButton.textContent = '✓';
          copyButton.title = 'Copied';
          setTimeout(() => {
            copyButton.textContent = '⧉';
            copyButton.title = 'Copy';
          }, 1200);
        };
        actions.append(copyButton);

        if (message.sourceUserText) {
          const regenerate = document.createElement('button');
          regenerate.type = 'button';
          regenerate.className = 'agent-mini-icon-button';
          regenerate.textContent = '↻';
          regenerate.setAttribute('aria-label', 'Regenerate');
          regenerate.title = 'Regenerate';
          regenerate.onclick = () => {
            if (state.runningTurnId) {
              return;
            }
            lastUserTextForTurn = message.sourceUserText || '';
            worker.send(lastUserTextForTurn);
          };
          actions.append(regenerate);
        }

        externalActions = actions;
      }

      if (message.failedReason) {
        const error = document.createElement('div');
        error.className = 'agent-error';
        error.textContent = `Error: ${message.failedReason}`;
        card.append(error);
      }

      stack.append(card);
      if (externalActions) {
        stack.append(externalActions);
      }
      row.append(stack);
      feed.append(row);
    }

    jumpWrap.style.display = state.showJumpToLatest ? 'flex' : 'none';

    maybeScrollToBottom();
  }

  const upsertAssistantMessage = (turnId: string, messageId: string): ChatMessageView => {
    let message = state.messages.find((item) => item.id === messageId);
    if (message) {
      return message;
    }
    message = {
      id: messageId,
      role: 'assistant',
      content: '',
      thinkingContent: '',
      thinkingStreaming: false,
      thinkingExpanded: false,
      thinkingManuallyCollapsed: false,
      createdAt: Date.now(),
      streaming: true,
      sourceUserText: lastUserTextForTurn,
      toolLogs: pendingLogsByTurn.get(turnId) ?? [],
    };
    pendingLogsByTurn.delete(turnId);
    activeAssistantIdByTurn.set(turnId, messageId);
    state.messages.push(message);
    return message;
  };

  const attachToolLogToCurrentTurn = (log: ToolLogView): void => {
    const currentTurn = state.runningTurnId;
    if (!currentTurn) {
      const lastAssistant = findLastAssistant(state.messages);
      if (lastAssistant) {
        lastAssistant.toolLogs.push(log);
      }
      return;
    }

    const assistantId = activeAssistantIdByTurn.get(currentTurn);
    if (assistantId) {
      const assistant = state.messages.find((item) => item.id === assistantId);
      if (assistant) {
        assistant.toolLogs.push(log);
        return;
      }
    }

    const pending = pendingLogsByTurn.get(currentTurn) ?? [];
    pending.push(log);
    pendingLogsByTurn.set(currentTurn, pending);
  };

  const handleWorkerEvent = (event: RunnerEvent) => {
    if (event.type === 'runner.state.changed') {
      state.runningTurnId = event.payload.runningTurnId;
      refreshPrimaryButtonState();
      return;
    }

    if (event.type === 'assistant.stream.delta') {
      const message = upsertAssistantMessage(event.payload.turnId, event.payload.messageId);
      message.content += event.payload.delta;
      message.streaming = true;
      markNewContentArrived();
      renderMessages();
      return;
    }

    if (event.type === 'assistant.thinking.delta') {
      const message = upsertAssistantMessage(event.payload.turnId, event.payload.messageId);
      message.thinkingContent = `${message.thinkingContent ?? ''}${event.payload.delta}`;
      message.thinkingStreaming = true;
      if (!message.thinkingManuallyCollapsed) {
        message.thinkingExpanded = true;
      }
      markNewContentArrived();
      renderMessages();
      return;
    }

    if (event.type === 'assistant.thinking.completed') {
      const message = upsertAssistantMessage(event.payload.turnId, event.payload.messageId);
      message.thinkingStreaming = false;
      message.thinkingExpanded = false;
      message.thinkingManuallyCollapsed = false;
      renderMessages();
      return;
    }

    if (event.type === 'assistant.turn.completed') {
      const message = upsertAssistantMessage(event.payload.turnId, event.payload.messageId);
      message.streaming = false;
      message.thinkingStreaming = false;
      message.content = stripPseudoToolTags(event.payload.content);
      const duration = event.payload.timing.durationMs ?? 0;
      message.cookedLabel = `Cooked for ${Math.floor(duration / 60000)} m ${Math.floor((duration % 60000) / 1000)} s`;
      markNewContentArrived();
      renderMessages();
      return;
    }

    if (event.type === 'assistant.turn.canceled') {
      const assistantId = activeAssistantIdByTurn.get(event.payload.turnId);
      const message = assistantId ? state.messages.find((item) => item.id === assistantId) : undefined;
      if (message) {
        message.streaming = false;
        message.thinkingStreaming = false;
        message.thinkingExpanded = false;
        message.thinkingManuallyCollapsed = false;
      }
      renderMessages();
      return;
    }

    if (event.type === 'chat.message.failed') {
      state.messages.push({
        id: createMessageId('assistant-failed'),
        role: 'assistant',
        content: '',
        thinkingContent: '',
        thinkingStreaming: false,
        thinkingExpanded: false,
        thinkingManuallyCollapsed: false,
        createdAt: Date.now(),
        failedReason: event.payload.reason,
        sourceUserText: lastUserTextForTurn,
        toolLogs: [],
      });
      markNewContentArrived();
      renderMessages();
      return;
    }

    if (event.type === 'tool.call.completed') {
      attachToolLogToCurrentTurn({
        id: event.payload.id,
        name: event.payload.name,
        status: event.payload.status,
        durationMs: event.payload.durationMs,
        request: event.payload.request,
        response: event.payload.response,
        errorMessage: event.payload.errorMessage,
        expanded: false,
      });
      markNewContentArrived();
      renderMessages();
      return;
    }

    if (event.type === 'apply.status.changed') {
      pulseEditorBorder(event.payload.status);
    }
  };

  const bindWorker = (nextSettings: AgentSettings): void => {
    unsubscribeWorker?.();
    runtimeOverrides = readRuntimeOverrides();
    worker = createRunnerWorkerClient(nextSettings, hostContext);
    unsubscribeWorker = worker.subscribe(handleWorkerEvent);
  };

  function persistPatch(patch: Partial<AgentSettings>): void {
    settings = saveSettings(patch);
    bindWorker(settings);
    void refreshDevScenarioOptions();
  }

  const setScenarioOptions = (options: string[], selected?: string) => {
    devScenarioSelect.innerHTML = '';
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = '(none)';
    devScenarioSelect.append(noneOption);

    for (const scenario of options) {
      const option = document.createElement('option');
      option.value = scenario;
      option.textContent = scenario;
      devScenarioSelect.append(option);
    }

    if (selected && !options.includes(selected)) {
      const current = document.createElement('option');
      current.value = selected;
      current.textContent = `${selected} (current)`;
      devScenarioSelect.append(current);
    }
    devScenarioSelect.value = selected ?? '';
  };

  const refreshDevScenarioOptions = async () => {
    const baseUrl = readRuntimeOverrides().openRouterBaseUrl;
    const currentScenario = readRuntimeScenario();
    if (!isDevFakeUiEnabled()) {
      devScenarioLabel.style.display = 'none';
      return;
    }

    devScenarioLabel.style.display = 'grid';
    devScenarioStatus.textContent = 'Loading scenarios...';
    setScenarioOptions([], currentScenario);

    try {
      const response = await fetch(buildScenariosUrl(baseUrl ?? 'http://localhost:8787/api/v1'));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as { scenarios?: unknown };
      const scenarios = Array.isArray(data.scenarios)
        ? data.scenarios.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      setScenarioOptions(scenarios, currentScenario);
      devScenarioStatus.textContent = currentScenario ? `Using scenario: ${currentScenario}` : 'Using scenario: none';
    } catch (error) {
      setScenarioOptions([], currentScenario);
      devScenarioStatus.textContent = `Failed to load scenarios: ${(error as Error).message}`;
    }
  };

  const refreshDevKnowledgeVisibility = () => {
    const visible = isDevFakeUiEnabled();
    knowledgeWrap.style.display = visible ? 'grid' : 'none';
    runDevKnowledge.style.display = visible ? 'inline-flex' : 'none';
    devKnowledgeStatus.style.display = visible ? 'block' : 'none';
    devScenarioLabel.style.display = visible ? 'grid' : 'none';
  };

  composer.addEventListener('compositionstart', () => {
    state.isComposing = true;
  });
  composer.addEventListener('compositionend', () => {
    state.isComposing = false;
  });
  composer.addEventListener('input', () => {
    refreshPrimaryButtonState();
  });

  composer.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || state.isComposing) {
      return;
    }
    event.preventDefault();
    primaryButton.click();
  });

  primaryButton.onclick = () => {
    if (state.runningTurnId) {
      worker.stop(state.runningTurnId);
      return;
    }

    const text = composer.value.trim();
    if (!text) {
      return;
    }

    state.messages.push({
      id: createMessageId('user'),
      role: 'user',
      content: text,
      createdAt: Date.now(),
      toolLogs: [],
    });
    markNewContentArrived();
    renderMessages();

    composer.value = '';
    refreshPrimaryButtonState();

    lastUserTextForTurn = text;
    if (isJamPrompt(text) && !isHostStarted(hostContext)) {
      startPlaybackFromUserGesture(hostContext);
    }
    worker.send(text);
  };

  clearButton.onclick = () => {
    worker.stop();
    worker.resetContext({ omitRuntimeContext: true });

    composer.value = '';
    state.messages = [];
    state.runningTurnId = null;
    state.showJumpToLatest = false;
    state.openPopover = null;
    activeAssistantIdByTurn = new Map<string, string>();
    pendingLogsByTurn = new Map<string, ToolLogView[]>();
    clearChatSession();

    const editor = hostContext?.editorRef?.current as { code?: string; setCode?: (code: string) => void } | undefined;
    if (editor) {
      editor.code = '';
      editor.setCode?.('');
    }

    try {
      const mirror = (window as Window & { strudelMirror?: { repl?: { stop?: () => void } } }).strudelMirror;
      mirror?.repl?.stop?.();
    } catch {
      // no-op
    }

    refreshPopoverVisibility();
    renderMessages();
    refreshPrimaryButtonState();
  };

  settingsButton.onclick = () => {
    togglePopover('settings');
  };

  devButton.onclick = () => {
    togglePopover('dev');
  };

  root.addEventListener('click', (event) => {
    const target = event.target as Node | null;
    if (!target) {
      return;
    }
    if (
      settingsPopover.contains(target) ||
      devPopover.contains(target) ||
      settingsButton.contains(target) ||
      devButton.contains(target)
    ) {
      return;
    }
    if (state.openPopover) {
      state.openPopover = null;
      refreshPopoverVisibility();
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.openPopover) {
      state.openPopover = null;
      refreshPopoverVisibility();
    }
  });

  modelInput.addEventListener('input', () => persistPatch({ model: modelInput.value }));
  tempInput.addEventListener('input', () => persistPatch({ temperature: Number(tempInput.value) }));
  apiKeyInput.addEventListener('input', () => persistPatch({ apiKey: apiKeyInput.value.trim() }));
  mode.addEventListener('change', () => persistPatch({ reasoningMode: mode.value as AgentSettings['reasoningMode'] }));

  devScenarioSelect.addEventListener('change', () => {
    const nextScenario = devScenarioSelect.value || undefined;
    writeRuntimeScenario(nextScenario);
    bindWorker(settings);
    const label = nextScenario || 'none';
    devScenarioStatus.textContent = `Using scenario: ${label}`;
  });

  runDevKnowledge.addEventListener('click', async () => {
    const q = devKnowledgeQuery.value.trim();
    if (!q) {
      devKnowledgeStatus.textContent = 'Query is required.';
      return;
    }
    const request = {
      query: {
        q,
        domain: devKnowledgeDomain.value as 'auto' | 'reference' | 'sounds',
      },
    };
    devKnowledgeStatus.textContent = 'Running...';
    runDevKnowledge.disabled = true;
    try {
      const response = await worker.runDevKnowledge(request);
      devKnowledgeStatus.textContent = 'Completed.';
      const target = findLastAssistant(state.messages);
      const log: ToolLogView = {
        id: createMessageId('dev-knowledge'),
        name: 'strudel_knowledge',
        status: 'succeeded',
        durationMs: 0,
        request,
        response,
        expanded: false,
      };
      if (target) {
        target.toolLogs.push(log);
      } else {
        state.messages.push({
          id: createMessageId('assistant-dev'),
          role: 'assistant',
          content: 'Dev knowledge query completed.',
          thinkingContent: '',
          thinkingStreaming: false,
          thinkingExpanded: false,
          thinkingManuallyCollapsed: false,
          createdAt: Date.now(),
          toolLogs: [log],
        });
      }
      markNewContentArrived();
      renderMessages();
    } catch (error) {
      devKnowledgeStatus.textContent = `Failed: ${(error as Error).message}`;
    } finally {
      runDevKnowledge.disabled = false;
    }
  });

  devToggle.addEventListener('change', () => {
    writeDevFakeUiEnabled(devToggle.checked);
    if (devToggle.checked) {
      enableMockRuntimeDefaults();
    } else {
      clearMockRuntimeOverrides();
      writeRuntimeScenario(undefined);
    }
    bindWorker(settings);
    void refreshDevScenarioOptions();
    refreshDevKnowledgeVisibility();
  });

  feed.addEventListener('scroll', () => {
    const threshold = 48;
    const distance = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    const nextPinned = distance <= threshold;
    state.pinnedToBottom = nextPinned;
    state.showJumpToLatest = !nextPinned;
    jumpWrap.style.display = state.showJumpToLatest ? 'flex' : 'none';
  });

  bindWorker(settings);
  void refreshDevScenarioOptions();
  refreshDevKnowledgeVisibility();
  refreshPopoverVisibility();
  renderMessages();
  refreshPrimaryButtonState();
}

export function initAgentTab(): void {
  registerAgentTabRenderer({
    render(container, context) {
      mountAgentUi(container, context as AgentHostContext);
    },
    unmount(container) {
      container.innerHTML = '';
    },
  });
}

if (typeof window !== 'undefined') {
  (window as Window & { __CHATRAVE_INIT_AGENT_TAB__?: () => void }).__CHATRAVE_INIT_AGENT_TAB__ = initAgentTab;

  const standaloneRoot = document.getElementById('app');
  if (standaloneRoot) {
    mountAgentUi(standaloneRoot);
  }
}

export { DEFAULT_AGENT_SETTINGS };
