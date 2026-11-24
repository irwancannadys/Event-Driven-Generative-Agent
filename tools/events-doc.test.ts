import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTORS, AGENT_IDS, EVENT_META, EVENT_TYPES, ORIGINS } from '@cafe/core';
import { describe, expect, it } from 'vitest';

// Guards against drift: docs/events.md is the contract and packages/core must match it.
const doc = fs.readFileSync(fileURLToPath(new URL('../docs/events.md', import.meta.url)), 'utf8');

function between(startHeading: string, endHeading: string): string {
  const start = doc.indexOf(startHeading);
  const end = doc.indexOf(endHeading);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`docs/events.md: cannot find "${startHeading}" ... "${endHeading}"`);
  }
  return doc.slice(start, end);
}

interface CatalogRow {
  type: string;
  origins: string[];
  actors: string[];
}

function tokens<T extends string>(cell: string, known: readonly T[]): T[] {
  return known.filter((word) => new RegExp(`\\b${word}\\b`).test(cell));
}

const catalog = between('## 2. Katalog', '## 3. Payload');
const rows: CatalogRow[] = catalog.split('\n').flatMap((line) => {
  const match = /^\| `([a-z_]+)`[^|]*\| ([^|]+?) \| ([^|]+?) \|/.exec(line);
  if (!match) return [];
  const [, type = '', originCell = '', actorCell = ''] = match;
  const actors = actorCell.includes('agent terkait') ? [...AGENT_IDS] : tokens(actorCell, ACTORS);
  return [{ type, origins: tokens(originCell, ORIGINS), actors }];
});

describe('docs/events.md matches packages/core', () => {
  it('lists exactly the event types defined in code', () => {
    expect(rows.map((row) => row.type).sort()).toEqual([...EVENT_TYPES].sort());
    expect(doc).toContain(`**${EVENT_TYPES.length} event**`);
  });

  it('documents the same origins for every event', () => {
    for (const row of rows) {
      const inCode = [...EVENT_META[row.type as keyof typeof EVENT_META].origins].sort();
      expect([...row.origins].sort(), `${row.type} origins`).toEqual(inCode);
    }
  });

  it('documents the same actors for every event', () => {
    for (const row of rows) {
      const inCode = [...EVENT_META[row.type as keyof typeof EVENT_META].actors].sort();
      expect([...row.actors].sort(), `${row.type} actors`).toEqual(inCode);
    }
  });

  it('has a payload definition for every event', () => {
    const payloads = between('## 3. Payload', '## 4. Contoh urutan');
    for (const type of EVENT_TYPES) {
      expect(new RegExp(`^\\s*${type}:`, 'm').test(payloads), `payload of ${type}`).toBe(true);
    }
  });
});
