import { Bars3Icon, PlayIcon, StopIcon, XMarkIcon } from '@heroicons/react/16/solid';
import { useEffect, useRef, useState } from 'react';
import cx from '@src/cx.mjs';
import { StrudelIcon } from '@src/repl/components/icons/StrudelIcon';
import { useSettings, setIsZen, setIsPanelOpened, setActiveFooter as setTab } from '../../../settings.mjs';
import '../../Repl.css';
import { useLogger } from '../useLogger';
import { ConsoleTab } from './ConsoleTab';
import ExportTab from './ExportTab';
import { FilesTab } from './FilesTab';
import { PatternsTab } from './PatternsTab';
import { Reference } from './Reference';
import { SettingsTab } from './SettingsTab';
import { SoundsTab } from './SoundsTab';

const TAURI = typeof window !== 'undefined' && window.__TAURI__;

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

export function LogoButton({ context, isEmbedded }) {
  const { started } = context;
  const { isZen, isCSSAnimationDisabled, fontFamily } = useSettings();
  return (
    <div
      className={cx(
        'mt-[1px]',
        started && !isCSSAnimationDisabled && 'animate-spin',
        'cursor-pointer text-blue-500',
        isZen && 'fixed top-2 right-4',
      )}
      onClick={() => {
        if (!isEmbedded) {
          setIsZen(!isZen);
        }
      }}
    >
      <span className="block text-foreground rotate-90">
        <StrudelIcon className="w-5 h-5 fill-foreground" />
      </span>
    </div>
  );
}

export function MainPanel({ context, isEmbedded = false, className }) {
  const { isZen, isButtonRowHidden, fontFamily } = useSettings();
  return (
    <nav
      id="header"
      className={cx(
        'flex-none text-black z-[100] text-sm select-none min-h-10 max-h-10',
        !isZen && !isEmbedded && 'border-b border-muted bg-lineHighlight',
        isZen ? 'h-12 w-8 fixed top-0 left-0' : '',
        'flex items-center',
        className,
      )}
      style={{ fontFamily }}
    >
      <div className={cx('flex w-full justify-between')}>
        <div className="px-3 py-1 flex space-x-2 select-none">
          <h1
            onClick={() => {
              if (isEmbedded) window.open(window.location.href.replace('embed', ''));
            }}
            className={cx(
              isEmbedded ? 'text-l cursor-pointer' : 'text-xl',
              'text-foreground font-bold flex space-x-2 items-center',
            )}
          >
            <LogoButton context={context} isEmbedded={isEmbedded} />
            {!isZen && (
              <div className="space-x-2 flex items-baseline">
                <span className="hidden sm:block">strudel</span>
                <span className="text-sm font-medium hidden sm:block">REPL</span>
              </div>
            )}
          </h1>
        </div>
        {!isZen && (
          <div className="flex grow justify-end">
            {!isButtonRowHidden && <MainMenu isEmbedded={isEmbedded} context={context} />}
            <PanelToggle isEmbedded={isEmbedded} isZen={isZen} />
          </div>
        )}
      </div>
    </nav>
  );
}

export function Footer({ context, isEmbedded = false }) {
  return (
    <div className="border-t border-muted bg-lineHighlight block lg:hidden">
      <MainMenu context={context} isEmbedded={isEmbedded} />
    </div>
  );
}

function MainMenu({ context, isEmbedded = false, className }) {
  const { started, pending, isDirty, activeCode, handleTogglePlay, handleEvaluate, handleShare } = context;
  const { isCSSAnimationDisabled } = useSettings();
  return (
    <div className={cx('flex text-sm max-w-full shrink-0 overflow-hidden text-foreground px-2 h-10', className)}>
      <button
        onClick={handleTogglePlay}
        title={started ? 'stop' : 'play'}
        className={cx('px-2 hover:opacity-50', !started && !isCSSAnimationDisabled && 'animate-pulse')}
      >
        <span className={cx('flex items-center space-x-2')}>
          {started ? <StopIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
          {!isEmbedded && <span>{pending ? '...' : started ? 'stop' : 'play'}</span>}
        </span>
      </button>
      <button
        onClick={handleEvaluate}
        title="update"
        className={cx('flex items-center space-x-1 px-2', !isDirty || !activeCode ? 'opacity-50' : 'hover:opacity-50')}
      >
        {!isEmbedded && <span>update</span>}
      </button>
      {!isEmbedded && (
        <button
          title="share"
          className={cx('cursor-pointer hover:opacity-50 flex items-center space-x-1 px-2')}
          onClick={handleShare}
        >
          <span>share</span>
        </button>
      )}
      {!isEmbedded && (
        <a
          title="learn"
          href={`${baseNoTrailing}/workshop/getting-started/`}
          className={cx('hover:opacity-50 flex items-center space-x-1', !isEmbedded ? 'p-2' : 'px-2')}
        >
          <span>learn</span>
        </a>
      )}
    </div>
  );
}

function PanelCloseButton() {
  const { isPanelOpen } = useSettings();
  return (
    isPanelOpen && (
      <button
        onClick={() => setIsPanelOpened(false)}
        className={cx('px-2 py-0 text-foreground hover:opacity-50')}
        aria-label="Close Menu"
      >
        <XMarkIcon className="w-6 h-6" />
      </button>
    )
  );
}

export function BottomPanel({ context }) {
  const { isPanelOpen, activeFooter: tab } = useSettings();
  return (
    <PanelNav
      className={cx(
        isPanelOpen ? `min-h-[360px] max-h-[360px]` : 'min-h-10 max-h-10',
        'overflow-hidden flex flex-col relative',
      )}
    >
      <div className="flex justify-between min-h-10 max-h-10 grid-cols-2 items-center border-t border-muted">
        <PanelCloseButton />
        <Tabs setTab={setTab} tab={tab} className={cx(isPanelOpen && 'border-l border-muted')} />
      </div>
      {isPanelOpen && (
        <div className="w-full h-full overflow-auto border-t border-muted">
          <PanelContent context={context} tab={tab} />
        </div>
      )}
    </PanelNav>
  );
}

export function RightPanel({ context }) {
  const settings = useSettings();
  const { activeFooter: tab, isPanelOpen } = settings;
  if (!isPanelOpen) {
    return;
  }
  return (
    <PanelNav
      settings={settings}
      className={cx(
        'border-l border-muted shrink-0 h-full overflow-hidden',
        isPanelOpen ? `min-w-[min(600px,100vw)] max-w-[min(600px,80vw)]` : 'min-w-12 max-w-12',
      )}
    >
      <div className={cx('flex flex-col h-full')}>
        <div className="flex justify-between w-full overflow-hidden border-b border-muted min-h-10 max-h-10">
          <PanelCloseButton />
          <Tabs setTab={setTab} tab={tab} className="border-l border-muted" />
        </div>
        <div className="overflow-auto h-full">
          <PanelContent context={context} tab={tab} />
        </div>
      </div>
    </PanelNav>
  );
}

const tabNames = {
  agent: 'agent',
  patterns: 'patterns',
  sounds: 'sounds',
  reference: 'reference',
  export: 'export',
  console: 'console',
  settings: 'settings',
};
if (TAURI) {
  tabNames.files = 'files';
}

function normalizeTab(tab) {
  return tab === 'intro' ? tabNames.agent : tab;
}

function PanelNav({ children, className, ...props }) {
  const settings = useSettings();
  return (
    <nav
      onClick={() => {
        if (!settings.isPanelOpen) {
          setIsPanelOpened(true);
        }
      }}
      aria-label="Menu Panel"
      className={cx('h-full bg-lineHighlight group overflow-x-auto', className)}
      {...props}
    >
      {children}
    </nav>
  );
}

function PanelContent({ context, tab }) {
  useLogger();
  switch (normalizeTab(tab)) {
    case tabNames.patterns:
      return <PatternsTab context={context} />;
    case tabNames.console:
      return <ConsoleTab />;
    case tabNames.sounds:
      return <SoundsTab />;
    case tabNames.reference:
      return <Reference />;
    case tabNames.export:
      return <ExportTab handleExport={context.handleExport} />;
    case tabNames.settings:
      return <SettingsTab started={context.started} />;
    case tabNames.agent:
      return <AgentTabHost context={context} />;
    case tabNames.files:
      return <FilesTab />;
    default:
      return <AgentTabHost context={context} />;
  }
}

function AgentTabHost({ context }) {
  const hostRef = useRef(null);
  const contextProxyRef = useRef({});
  const [status, setStatus] = useState('booting');
  const [bootError, setBootError] = useState('');

  Object.assign(contextProxyRef.current, context);

  useEffect(() => {
    let canceled = false;
    const host = hostRef.current;
    if (!host) {
      return () => {};
    }

    const renderIntoHost = () => {
      const renderer = window.__CHATRAVE_AGENT_TAB_RENDERER__;
      if (!renderer) {
        return false;
      }
      renderer.render(host, contextProxyRef.current);
      setStatus('ready');
      return true;
    };

    const bootstrap = async () => {
      if (renderIntoHost()) {
        return;
      }

      const isLocalOrigin = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
      const preferred = window.localStorage.getItem('chatraveAgentModuleUrl');
      const preferredUrl = preferred ? (() => {
        try {
          return new URL(preferred, window.location.origin);
        } catch {
          return null;
        }
      })() : null;
      const isPreferredLocalhost = preferredUrl
        ? /^(localhost|127\.0\.0\.1)$/i.test(preferredUrl.hostname)
        : false;
      const safePreferred = !preferred
        ? null
        : !isLocalOrigin && isPreferredLocalhost
          ? null
          : preferred;

      const fallbackModuleUrls = isLocalOrigin
        ? [
            `${window.location.origin}/chatrave-agent/agent-tab.js`,
            'http://localhost:4174/src/index.ts',
            'http://localhost:4175/src/index.ts',
          ]
        : [`${window.location.origin}/chatrave-agent/agent-tab.js`];
      const moduleUrls = preferred
        ? [safePreferred, ...fallbackModuleUrls.filter((url) => url !== safePreferred)].filter(Boolean)
        : fallbackModuleUrls;

      for (const moduleUrl of moduleUrls) {
        try {
          // eslint-disable-next-line no-eval
          await import(/* @vite-ignore */ moduleUrl);
          window.__CHATRAVE_INIT_AGENT_TAB__?.();
          if (!canceled && renderIntoHost()) {
            window.localStorage.setItem('chatraveAgentModuleUrl', moduleUrl);
            return;
          }
        } catch (error) {
          if (moduleUrl === moduleUrls[moduleUrls.length - 1] && !canceled) {
            setStatus('error');
            setBootError(
              `Failed to load agent module from tried URLs (${moduleUrls.join(', ')}). Last error: ${String(error)}`,
            );
          }
        }
      }
    };

    bootstrap();

    return () => {
      canceled = true;
      const renderer = window.__CHATRAVE_AGENT_TAB_RENDERER__;
      renderer?.unmount?.(host);
    };
  }, []);

  return (
    <div className="w-full h-full relative">
      <div id="agent-tab" ref={hostRef} className="w-full h-full" />
      {status !== 'ready' && (
        <div className="absolute inset-0 text-xs text-foreground opacity-80 pointer-events-none p-2">
          <div>Booting agent tab...</div>
          {status === 'error' && <div className="mt-2 text-red-500">{bootError}</div>}
          <div className="mt-2">
            Tip: run <code>pnpm --filter @chatrave/agent-web dev</code> and set{' '}
            <code>localStorage.chatraveAgentModuleUrl</code> if needed.
          </div>
        </div>
      )}
    </div>
  );
}

function PanelTab({ label, isSelected, onClick }) {
  return (
    <>
      <button
        onClick={onClick}
        className={cx(
          'h-10 px-2 text-sm border-t-2 border-t-transparent text-foreground cursor-pointer hover:opacity-50 flex items-center space-x-1 border-b-2',
          isSelected ? 'border-foreground' : 'border-transparent',
        )}
      >
        {label}
      </button>
    </>
  );
}
function Tabs({ className }) {
  const { isPanelOpen, activeFooter: tab } = useSettings();
  const normalizedTab = normalizeTab(tab);
  return (
    <div
      className={cx(
        'px-2 w-full flex select-none max-w-full h-10 max-h-10 min-h-10 overflow-auto items-center',
        className,
      )}
    >
      {Object.keys(tabNames).map((key) => {
        const val = tabNames[key];
        return (
          <PanelTab key={key} isSelected={normalizedTab === val && isPanelOpen} label={key} onClick={() => setTab(val)} />
        );
      })}
    </div>
  );
}

export function PanelToggle({ isEmbedded, isZen }) {
  const { panelPosition, isPanelOpen } = useSettings();
  return (
    !isEmbedded &&
    !isZen &&
    panelPosition === 'right' && (
      <button
        title="menu"
        className={cx('border-l border-muted px-2 py-0 text-foreground hover:opacity-50')}
        onClick={() => setIsPanelOpened(!isPanelOpen)}
      >
        <Bars3Icon className="w-6 h-6" />
      </button>
    )
  );
}
