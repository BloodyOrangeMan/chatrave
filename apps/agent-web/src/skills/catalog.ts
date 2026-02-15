import jazzRaw from './jazz/SKILL.md?raw';
import technoRaw from './techno/SKILL.md?raw';
import houseRaw from './house/SKILL.md?raw';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
}

type Frontmatter = {
  name?: string;
  description?: string;
  tags?: string[];
};

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const source = raw.trim();
  if (!source.startsWith('---\n')) {
    return { frontmatter: {}, body: source };
  }

  const end = source.indexOf('\n---\n', 4);
  if (end < 0) {
    return { frontmatter: {}, body: source };
  }

  const metaBlock = source.slice(4, end).trim();
  const body = source.slice(end + 5).trim();
  const frontmatter: Frontmatter = {};

  for (const line of metaBlock.split('\n')) {
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!key) continue;

    if (key === 'tags') {
      const cleaned = value.replace(/^\[/, '').replace(/\]$/, '');
      frontmatter.tags = cleaned
        .split(',')
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      continue;
    }

    const normalized = value.replace(/^['"]|['"]$/g, '');
    if (key === 'name') frontmatter.name = normalized;
    if (key === 'description') frontmatter.description = normalized;
  }

  return { frontmatter, body };
}

function makeSkill(id: string, raw: string): SkillDefinition {
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    id,
    name: frontmatter.name?.trim() || id,
    description: frontmatter.description?.trim() || `${id} style guidance`,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
    content: body,
  };
}

export const SKILLS: SkillDefinition[] = [
  makeSkill('jazz', jazzRaw),
  makeSkill('techno', technoRaw),
  makeSkill('house', houseRaw),
];
