export interface SoundEntry {
  key: string;
  data?: {
    type?: string;
    tag?: string;
    prebake?: boolean;
    samples?: unknown[];
    tables?: unknown[];
    fonts?: unknown[];
  };
}

export interface SoundIndexItem {
  name: string;
  type: string;
  tag: string;
  prebake: boolean;
}

export function buildSoundsIndex(entries: SoundEntry[]): SoundIndexItem[] {
  return entries
    .filter((entry) => entry.key && !entry.key.startsWith('_'))
    .map((entry) => ({
      name: entry.key,
      type: entry.data?.type ?? 'unknown',
      tag: entry.data?.tag ?? '',
      prebake: Boolean(entry.data?.prebake),
    }));
}
