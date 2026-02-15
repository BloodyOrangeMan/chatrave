import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '@chatrave/shared-types';
import { loadSettings, saveSettings } from '@chatrave/storage-local';
import type { StrudelKnowledgeInput } from '@chatrave/agent-tools';
import { createChatRuntime, type AgentHostContext, type ChatRuntime } from './worker-client';
import {
  clearMockRuntimeOverrides,
  enableMockRuntimeDefaults,
  getRuntimeScenarios,
  isDevFakeUiEnabled,
  readRuntimeScenario,
  writeDevFakeUiEnabled,
  writeRuntimeScenario,
} from './runtime-overrides';
import { clearChatSession, loadChatSession, saveChatSession } from './chat-session-store';
import { formatJsonBlock } from './ui-helpers';
import { IconCopy, IconRefresh, IconTrash, IconSettings, IconWrench, IconAgent, IconUser } from './icons';

type ToolView = {
  id: string;
  name: string;
  state: 'succeeded' | 'failed';
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const EMPTY_HINT_CHIPS = ['Give me a techno beat', 'Add a bassline layer', 'Make it more minimal', 'Explain this pattern'];

function cookLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `Cooked for ${minutes} m ${seconds} s`;
}

function textParts(message: UIMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function reasoningParts(message: UIMessage): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part): part is { type: 'reasoning'; text: string } => part?.type === 'reasoning' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function toolParts(message: UIMessage): ToolView[] {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  const out: ToolView[] = [];

  for (const part of parts) {
    const type = typeof part?.type === 'string' ? part.type : '';
    const isTool = type.startsWith('tool-') || type === 'dynamic-tool';
    if (!isTool) continue;

    const state = (part as { state?: string }).state;
    if (state !== 'output-available' && state !== 'output-error' && state !== 'output-denied') continue;

    const id = (part as { toolCallId?: string }).toolCallId ?? `${type}-${out.length}`;
    const name =
      type === 'dynamic-tool'
        ? ((part as { toolName?: string }).toolName ?? 'dynamic_tool')
        : type.replace(/^tool-/, '');

    out.push({
      id,
      name,
      state: state === 'output-available' ? 'succeeded' : 'failed',
      input: (part as { input?: unknown }).input,
      output: (part as { output?: unknown }).output,
      errorText: (part as { errorText?: string }).errorText,
    });
  }

  return out;
}

async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function MessageBubble({
  message,
  cooked,
  onRegenerate,
  expandToolsByDefault,
}: {
  message: UIMessage;
  cooked?: string;
  onRegenerate: (messageId: string) => void;
  expandToolsByDefault: boolean;
}) {
  const text = textParts(message).trim();
  const thinking = reasoningParts(message).trim();
  const tools = toolParts(message);
  const [expandedToolMap, setExpandedToolMap] = useState<Record<string, boolean>>({});
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const isAssistant = message.role === 'assistant';

  const thinkingPreview = thinking.length > 140 ? `${thinking.slice(0, 140)}...` : thinking;

  return (
    <div className={`msg-row ${isAssistant ? 'assistant' : 'user'}`}>
      <div className="msg-avatar">{isAssistant ? <IconAgent /> : <IconUser />}</div>
      <div className="msg-body">
        {thinking ? (
          <button type="button" className="thinking-bar" onClick={() => setThinkingExpanded((v) => !v)}>
            <span className="thinking-title">Thinking</span>
            <span className="thinking-preview">{thinkingExpanded ? thinking : thinkingPreview}</span>
            {cooked ? <span className="cooked-label">{cooked}</span> : null}
          </button>
        ) : null}

        {tools.map((tool) => {
          const expanded = expandedToolMap[tool.id] ?? expandToolsByDefault;
          return (
            <div key={tool.id} className="tool-item">
              <button
                type="button"
                className={`tool-head ${tool.state === 'succeeded' ? 'ok' : 'bad'}`}
                onClick={() => setExpandedToolMap((prev) => ({ ...prev, [tool.id]: !expanded }))}
              >
                <span>{tool.name}</span>
                <span>{tool.state === 'succeeded' ? 'succeeded' : 'failed'}</span>
              </button>
              {expanded ? (
                <div className="tool-detail">
                  <div className="tool-title-row">
                    <span>[Tool Request]</span>
                    <button
                      type="button"
                      className="mini-copy"
                      onClick={() => void copyToClipboard(formatJsonBlock(tool.input))}
                    >
                      Copy
                    </button>
                  </div>
                  <pre>{formatJsonBlock(tool.input)}</pre>

                  <div className="tool-title-row">
                    <span>[Tool Response]</span>
                    <button
                      type="button"
                      className="mini-copy"
                      onClick={() => void copyToClipboard(formatJsonBlock(tool.output ?? null))}
                    >
                      Copy
                    </button>
                  </div>
                  <pre>{formatJsonBlock(tool.output ?? null)}</pre>

                  {tool.errorText ? (
                    <>
                      <div className="tool-title-row">
                        <span>[Tool Error]</span>
                        <button
                          type="button"
                          className="mini-copy"
                          onClick={() => void copyToClipboard(tool.errorText as string)}
                        >
                          Copy
                        </button>
                      </div>
                      <pre>{tool.errorText}</pre>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {text ? <div className={`msg-bubble ${isAssistant ? 'assistant' : 'user'}`}>{text}</div> : null}

        {isAssistant ? (
          <div className="msg-actions">
            <button type="button" className="icon-btn" title="Copy response" onClick={() => void copyToClipboard(text || thinking)}>
              <IconCopy />
            </button>
            <button type="button" className="icon-btn" title="Regenerate" onClick={() => onRegenerate(message.id)}>
              <IconRefresh />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChatRuntimePane({
  runtime,
  expandToolsByDefault,
}: {
  runtime: ChatRuntime;
  expandToolsByDefault: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [cookMap, setCookMap] = useState<Record<string, string>>({});
  const [isComposing, setIsComposing] = useState(false);
  const turnStartRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const { messages, sendMessage, stop, regenerate, status, error } = useChat<any>({
    messages: loadChatSession() as UIMessage[],
    transport: runtime.transport,
    onFinish: ({ message }) => {
      if (turnStartRef.current && turnStartRef.current > 0) {
        const duration = Date.now() - turnStartRef.current;
        // Only record if duration is reasonable (less than 10 minutes)
        if (duration > 0 && duration < 600000) {
          setCookMap((prev) => ({ ...prev, [message.id]: cookLabel(duration) }));
        }
      }
      turnStartRef.current = null;
    },
    onError: () => {
      turnStartRef.current = null;
    },
  });

  useEffect(() => {
    saveChatSession(messages);
  }, [messages]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !pinnedToBottom) return;
    list.scrollTop = list.scrollHeight;
    setShowJumpToLatest(false);
  }, [messages, status, pinnedToBottom]);

  const submit = async (text: string) => {
    const value = text.trim();
    if (!value) return;
    if (status === 'streaming' || status === 'submitted') return;
    turnStartRef.current = Date.now();
    await sendMessage({ text: value });
    setDraft('');
  };

  return (
    <>
      <div
        ref={listRef}
        className="messages"
        onScroll={(event) => {
          const target = event.currentTarget;
          const distance = target.scrollHeight - target.scrollTop - target.clientHeight;
          const nearBottom = distance < 56;
          setPinnedToBottom(nearBottom);
          setShowJumpToLatest(!nearBottom);
        }}
      >
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">Start jamming with text.</div>
            <div className="chip-row">
              {EMPTY_HINT_CHIPS.map((chip) => (
                <button key={chip} type="button" className="chip" onClick={() => setDraft(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            cooked={cookMap[message.id]}
            expandToolsByDefault={expandToolsByDefault}
            onRegenerate={(id) => {
              turnStartRef.current = Date.now();
              void regenerate({ messageId: id });
            }}
          />
        ))}
      </div>

      {showJumpToLatest ? (
        <button
          type="button"
          className="jump-btn"
          onClick={() => {
            const list = listRef.current;
            if (!list) return;
            list.scrollTop = list.scrollHeight;
            setPinnedToBottom(true);
            setShowJumpToLatest(false);
          }}
        >
          Jump to latest
        </button>
      ) : null}

      {error ? <div className="error-row">{error.message}</div> : null}

      <div className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
            event.preventDefault();
            if (status === 'streaming' || status === 'submitted') {
              void stop();
              return;
            }
            void submit(draft);
          }}
          placeholder="Ask for a groove, tweak, or repair..."
        />
        <button
          type="button"
          className="send-btn"
          onClick={() => {
            if (status === 'streaming' || status === 'submitted') {
              void stop();
              return;
            }
            void submit(draft);
          }}
        >
          {status === 'streaming' || status === 'submitted' ? 'Stop' : 'Send'}
        </button>
      </div>
    </>
  );
}

export function AgentApp({ hostContext }: { hostContext?: AgentHostContext }) {
  const [settings, setSettings] = useState<AgentSettings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [showDev, setShowDev] = useState(false);
  const [mockEnabled, setMockEnabled] = useState<boolean>(() => isDevFakeUiEnabled());
  const [scenario, setScenario] = useState<string>(() => readRuntimeScenario() ?? getRuntimeScenarios()[0]);
  const [expandedTools, setExpandedTools] = useState(false);
  const [runtimeEpoch, setRuntimeEpoch] = useState(0);
  const [sessionEpoch, setSessionEpoch] = useState(0);

  const runtime = useMemo(() => createChatRuntime(settings, hostContext), [settings, hostContext, runtimeEpoch]);

  const bumpRuntime = (): void => {
    setRuntimeEpoch((value) => value + 1);
  };

  const clearAll = (): void => {
    clearChatSession();
    setSessionEpoch((value) => value + 1);
    bumpRuntime();
  };

  const patchSettings = (patch: Partial<AgentSettings>): void => {
    const next = saveSettings(patch);
    setSettings(next);
    bumpRuntime();
  };

  const runDevKnowledge = async (query: string): Promise<void> => {
    const input: StrudelKnowledgeInput = { query: { q: query, domain: 'auto' } };
    const result = await runtime.runDevKnowledge(input);
    const display = `[Dev] strudel_knowledge(${query}) => ${JSON.stringify(result)}`;
    const existing = loadChatSession() as UIMessage[];
    const synthetic: UIMessage = {
      id: `dev-${Date.now()}`,
      role: 'assistant',
      parts: [{ type: 'text', text: display }],
    } as unknown as UIMessage;
    saveChatSession([...existing, synthetic]);
    setSessionEpoch((value) => value + 1);
  };

  return (
    <div className="agent-root">
      <div className="agent-header">
        <div className="agent-title">Jam Agent</div>
        <div className="agent-head-actions">
          <button type="button" className="head-btn danger" onClick={clearAll} title="Clear code + conversation">
            <IconTrash /> Clear
          </button>
          <button type="button" className="head-btn" onClick={() => setShowSettings((value) => !value)} title="Settings">
            <IconSettings /> Settings
          </button>
          <button type="button" className="head-btn" onClick={() => setShowDev((value) => !value)} title="Developer tools">
            <IconWrench /> Dev
          </button>
        </div>
      </div>

      {showSettings ? (
        <div className="popover">
          <label>
            Model
            <input value={settings.model} onChange={(event) => patchSettings({ model: event.target.value })} />
          </label>
          <label>
            Reasoning mode
            <select
              value={settings.reasoningMode}
              onChange={(event) => patchSettings({ reasoningMode: event.target.value as AgentSettings['reasoningMode'] })}
            >
              <option value="fast">fast</option>
              <option value="balanced">balanced</option>
              <option value="deep">deep</option>
            </select>
          </label>
          <label>
            Temperature
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={settings.temperature}
              onChange={(event) => patchSettings({ temperature: Number(event.target.value) })}
            />
          </label>
          <label>
            API key
            <input type="password" value={settings.apiKey} onChange={(event) => patchSettings({ apiKey: event.target.value })} />
          </label>
        </div>
      ) : null}

      {showDev ? (
        <div className="popover">
          <label className="inline">
            <input
              type="checkbox"
              checked={mockEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setMockEnabled(enabled);
                writeDevFakeUiEnabled(enabled);
                if (enabled) {
                  enableMockRuntimeDefaults();
                  setScenario(readRuntimeScenario() ?? getRuntimeScenarios()[0]);
                } else {
                  clearMockRuntimeOverrides();
                }
                bumpRuntime();
              }}
            />
            Enable mock LLM
          </label>
          <label>
            Scenario
            <select
              value={scenario}
              disabled={!mockEnabled}
              onChange={(event) => {
                const value = event.target.value;
                setScenario(value);
                writeRuntimeScenario(value);
                bumpRuntime();
              }}
            >
              {getRuntimeScenarios().map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="head-btn" onClick={() => void runDevKnowledge('setcpm')}>
            Probe strudel_knowledge
          </button>
        </div>
      ) : null}

      <ChatRuntimePane key={`${runtimeEpoch}:${sessionEpoch}`} runtime={runtime} expandToolsByDefault={expandedTools} />

      <label className="inline tool-toggle">
        <input type="checkbox" checked={expandedTools} onChange={(event) => setExpandedTools(event.target.checked)} />
        Keep tool details expanded
      </label>
    </div>
  );
}

export function loadInitialSettings(): AgentSettings {
  return loadSettings() ?? DEFAULT_AGENT_SETTINGS;
}
