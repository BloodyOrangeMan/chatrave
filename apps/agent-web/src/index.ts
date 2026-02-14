import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@chatrave/shared-types';
import { loadSettings, saveSettings } from '@chatrave/storage-local';
import { registerAgentTabRenderer } from '@chatrave/strudel-adapter';
import { createRunnerWorkerClient } from './worker-client';

function createLabeledInput(labelText: string, input: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.style.display = 'flex';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '4px';
  wrapper.style.fontSize = '12px';
  const label = document.createElement('span');
  label.textContent = labelText;
  wrapper.append(label, input);
  return wrapper;
}

export function mountAgentUi(container: HTMLElement): void {
  const settings = loadSettings();
  const worker = createRunnerWorkerClient(settings);

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
  output.textContent = 'Agent ready.';

  const composer = document.createElement('textarea');
  composer.rows = 4;
  composer.placeholder = 'Ask the jam agent...';

  const send = document.createElement('button');
  send.textContent = 'Send';

  const stop = document.createElement('button');
  stop.textContent = 'Stop';

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
    if (option === settings.reasoningMode) item.selected = true;
    mode.append(item);
  }

  function persistPatch(patch: Partial<AgentSettings>): void {
    saveSettings(patch);
  }

  modelInput.addEventListener('change', () => persistPatch({ model: modelInput.value }));
  tempInput.addEventListener('change', () => persistPatch({ temperature: Number(tempInput.value) }));
  apiKeyInput.addEventListener('change', () => persistPatch({ apiKey: apiKeyInput.value }));
  mode.addEventListener('change', () => persistPatch({ reasoningMode: mode.value as AgentSettings['reasoningMode'] }));

  worker.subscribe((event) => {
    if (event.type === 'assistant.stream.delta') {
      output.textContent += event.payload.delta;
      return;
    }

    if (event.type === 'assistant.turn.completed') {
      output.textContent += `\n\nCooked for ${Math.floor((event.payload.timing.durationMs ?? 0) / 60000)} m ${Math.floor(((event.payload.timing.durationMs ?? 0) % 60000) / 1000)} s\n`;
      return;
    }

    if (event.type === 'chat.message.failed') {
      output.textContent += `\n\nError: ${event.payload.reason}\n`;
    }
  });

  send.onclick = () => {
    const text = composer.value.trim();
    if (!text) return;
    output.textContent += `\n\nYou: ${text}\nAssistant: `;
    worker.send(text);
  };

  stop.onclick = () => worker.stop();

  const buttonRow = document.createElement('div');
  buttonRow.style.display = 'flex';
  buttonRow.style.gap = '8px';
  buttonRow.append(send, stop);

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
    render(container) {
      mountAgentUi(container);
    },
    unmount(container) {
      container.innerHTML = '';
    },
  });
}

if (typeof window !== 'undefined') {
  (window as Window & { __CHATRAVE_INIT_AGENT_TAB__?: () => void }).__CHATRAVE_INIT_AGENT_TAB__ = initAgentTab;
}

export { DEFAULT_AGENT_SETTINGS };
