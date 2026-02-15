/**
 * Theme color extraction from Strudel's CodeMirror theme.
 * Provides CSS variables for agent UI styling based on Strudel's syntax highlighting colors.
 */

// Theme colors from Strudel's strudel-theme.mjs
// These are kept in sync with the theme but defined here to avoid direct dependency
const THEME_COLORS = {
  // Syntax highlighting colors
  keyword: '#c792ea', // Purple - used for thinking state
  string: '#c3e88d', // Green - used for assistant responses
  number: '#c3e88d', // Green
  typeName: '#c3e88d', // Green
  atom: '#f78c6c', // Orange
  comment: '#7d8799', // Muted gray
  definition: '#82aaff', // Blue
  propertyName: '#c792ea', // Purple
  attributeName: '#c792ea', // Purple
  variableName: '#c792ea', // Purple

  // UI settings colors
  caret: '#ffcc00', // Yellow accent
  background: '#222',
  foreground: '#fff',
};

function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export interface AgentThemeColors {
  // Thinking state (purple)
  thinking: string;
  thinkingSoft: string;
  thinkingLine: string;

  // Assistant response (green)
  response: string;
  responseSoft: string;
  responseLine: string;

  // User accent (yellow)
  user: string;
  userSoft: string;

  // Status colors
  success: string;
  successSoft: string;
  error: string;
  errorSoft: string;
}

export function getAgentThemeColors(): AgentThemeColors {
  return {
    // Thinking state (purple/keyword color)
    thinking: THEME_COLORS.keyword,
    thinkingSoft: hexToRgba(THEME_COLORS.keyword, 0.08),
    thinkingLine: hexToRgba(THEME_COLORS.keyword, 0.3),

    // Assistant response (green/string color)
    response: THEME_COLORS.string,
    responseSoft: hexToRgba(THEME_COLORS.string, 0.12),
    responseLine: hexToRgba(THEME_COLORS.string, 0.3),

    // User accent (blue/definition color)
    user: THEME_COLORS.definition,
    userSoft: hexToRgba(THEME_COLORS.definition, 0.12),

    // Status colors
    success: THEME_COLORS.string,
    successSoft: hexToRgba(THEME_COLORS.string, 0.08),
    error: '#ff6b6b',
    errorSoft: 'rgba(255, 107, 107, 0.1)',
  };
}

export function injectAgentThemeColors(): void {
  if (typeof document === 'undefined') return;

  // Remove existing style if present
  const existing = document.getElementById('agent-theme-colors');
  if (existing) {
    existing.remove();
  }

  const colors = getAgentThemeColors();
  const style = document.createElement('style');
  style.id = 'agent-theme-colors';

  style.textContent = `
    :root {
      /* Agent Thinking State (Purple) */
      --agent-thinking: ${colors.thinking};
      --agent-thinking-soft: ${colors.thinkingSoft};
      --agent-thinking-line: ${colors.thinkingLine};

      /* Agent Response State (Green) */
      --agent-response: ${colors.response};
      --agent-response-soft: ${colors.responseSoft};
      --agent-response-line: ${colors.responseLine};

      /* User Accent (Blue) */
      --agent-user: ${colors.user};
      --agent-user-soft: ${colors.userSoft};

      /* Status Colors */
      --agent-success: ${colors.success};
      --agent-success-soft: ${colors.successSoft};
      --agent-error: ${colors.error};
      --agent-error-soft: ${colors.errorSoft};
    }
  `;

  document.head.appendChild(style);
}
