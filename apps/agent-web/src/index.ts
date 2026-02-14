import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type RunnerEvent } from '@chatrave/shared-types';
import { loadSettings, saveSettings } from '@chatrave/storage-local';
import { registerAgentTabRenderer } from '@chatrave/strudel-adapter';
import { createRunnerWorkerClient, type AgentHostContext } from './worker-client';

const AGENT_OUTPUT_STORAGE_KEY = 'chatrave_agent_output_v1';

function loadPersistedOutputText(): string {
  try {
    return window.localStorage.getItem(AGENT_OUTPUT_STORAGE_KEY) || 'Agent ready.';
  } catch {
    return 'Agent ready.';
  }
}

function savePersistedOutputText(text: string): void {
  try {
    window.localStorage.setItem(AGENT_OUTPUT_STORAGE_KEY, text);
  } catch {
    // Ignore storage write failures.
  }
}

function createLabeledInput(labelText: string, input: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '4px';
  wrapper.style.fontSize = '12px';
  wrapper.style.color = '#f2f2f2';
  const label = document.createElement('span');
  label.textContent = labelText;
  wrapper.append(label, input);
  return wrapper;
}

function styleControl(control: HTMLElement): void {
  control.style.background = '#ffffff';
  control.style.color = '#111111';
  control.style.border = '1px solid #d0d0d0';
  control.style.borderRadius = '6px';
  control.style.padding = '8px';
}

function styleButton(button: HTMLButtonElement): void {
  button.style.background = '#ffffff';
  button.style.color = '#111111';
  button.style.border = '1px solid #d0d0d0';
  button.style.borderRadius = '6px';
  button.style.padding = '8px 12px';
  button.style.cursor = 'pointer';
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

export function mountAgentUi(container: HTMLElement, hostContext?: AgentHostContext): void {
  let settings = loadSettings();
  let worker = createRunnerWorkerClient(settings, hostContext);
  let unsubscribeWorker: (() => void) | null = null;

  const handleWorkerEvent = (event: RunnerEvent) => {
    if (event.type === 'assistant.stream.delta') {
      appendOutput(event.payload.delta);
      return;
    }

    if (event.type === 'assistant.turn.completed') {
      appendOutput(
        `\n\nCooked for ${Math.floor((event.payload.timing.durationMs ?? 0) / 60000)} m ${Math.floor(((event.payload.timing.durationMs ?? 0) % 60000) / 1000)} s\n`,
      );
      return;
    }

    if (event.type === 'chat.message.failed') {
      appendOutput(`\n\nError: ${event.payload.reason}\n`);
      return;
    }

    if (event.type === 'tool.call.completed') {
      appendOutput(`\n[Tool ${event.payload.name}: ${event.payload.status}]\n`);
    }
  };

  const bindWorker = (nextSettings: AgentSettings): void => {
    unsubscribeWorker?.();
    worker = createRunnerWorkerClient(nextSettings, hostContext);
    unsubscribeWorker = worker.subscribe(handleWorkerEvent);
  };

  const root = document.createElement('div');
  root.style.padding = '10px';
  root.style.display = 'grid';
  root.style.gap = '10px';

  const output = document.createElement('pre');
  output.style.minHeight = '180px';
  output.style.maxHeight = '260px';
  output.style.overflow = 'auto';
  output.style.whiteSpace = 'pre-wrap';
  output.style.background = '#101010';
  output.style.color = '#f2f2f2';
  output.style.padding = '8px';
  const appendOutput = (text: string): void => {
    output.textContent = `${output.textContent ?? ''}${text}`;
    savePersistedOutputText(output.textContent);
  };

  output.textContent = loadPersistedOutputText();

  const composer = document.createElement('textarea');
  composer.rows = 4;
  composer.placeholder = 'Ask the jam agent...';
  styleControl(composer);

  const send = document.createElement('button');
  send.textContent = 'Send';
  styleButton(send);

  const stop = document.createElement('button');
  stop.textContent = 'Stop';
  styleButton(stop);

  const clearAll = document.createElement('button');
  clearAll.textContent = 'Clear code + convo';
  styleButton(clearAll);

  const modelInput = document.createElement('input');
  modelInput.value = settings.model;
  styleControl(modelInput);

  const tempInput = document.createElement('input');
  tempInput.type = 'number';
  tempInput.min = '0';
  tempInput.max = '2';
  tempInput.step = '0.1';
  tempInput.value = String(settings.temperature);
  styleControl(tempInput);

  const apiKeyInput = document.createElement('input');
  apiKeyInput.type = 'password';
  apiKeyInput.value = settings.apiKey;
  styleControl(apiKeyInput);

  const mode = document.createElement('select');
  styleControl(mode);
  for (const option of ['fast', 'balanced', 'deep'] as const) {
    const item = document.createElement('option');
    item.value = option;
    item.textContent = option;
    if (option === settings.reasoningMode) item.selected = true;
    mode.append(item);
  }

  function persistPatch(patch: Partial<AgentSettings>): void {
    settings = saveSettings(patch);
    bindWorker(settings);
  }

  modelInput.addEventListener('input', () => persistPatch({ model: modelInput.value }));
  tempInput.addEventListener('input', () => persistPatch({ temperature: Number(tempInput.value) }));
  apiKeyInput.addEventListener('input', () => persistPatch({ apiKey: apiKeyInput.value.trim() }));
  mode.addEventListener('change', () => persistPatch({ reasoningMode: mode.value as AgentSettings['reasoningMode'] }));

  bindWorker(settings);

  send.onclick = () => {
    const text = composer.value.trim();
    if (!text) return;
    appendOutput(`\n\nYou: ${text}\nAssistant: `);
    if (isJamPrompt(text) && !isHostStarted(hostContext)) {
      startPlaybackFromUserGesture(hostContext);
    }
    worker.send(text);
  };

  stop.onclick = () => worker.stop();

  clearAll.onclick = () => {
    worker.stop();
    worker.resetContext({ omitRuntimeContext: true });

    composer.value = '';
    output.textContent = 'Agent ready.';
    savePersistedOutputText(output.textContent);

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
  };

  const buttonRow = document.createElement('div');
  buttonRow.style.display = 'flex';
  buttonRow.style.gap = '8px';
  buttonRow.append(send, stop, clearAll);

  root.append(
    output,
    composer,
    buttonRow,
    createLabeledInput('Model', modelInput),
    createLabeledInput('Reasoning mode', mode),
    createLabeledInput('Temperature', tempInput),
    createLabeledInput('API key', apiKeyInput),
  );

  container.innerHTML = '';
  container.append(root);
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
