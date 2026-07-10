export interface GraphEntity {
  entityId: string;
  entityType: string;
  name: string;
  aliases: string[];
  latestState: string | null;
  firstChapter: number;
  degree: number;
}

export interface GraphEdge {
  relId: string;
  sourceId: string;
  targetId: string;
  relType: string;
  description: string | null;
  sinceChapter: number;
  untilChapter: number | null;
}

/**
 * Colour palette keyed by entity type. Kept in sync with the legend rendered by
 * GraphPage. Unknown types fall back to a neutral grey.
 */
export const ENTITY_TYPE_COLORS: Record<string, string> = {
  character: '#7c8cff',
  faction: '#e0a34b',
  location: '#4bbf8a',
  item: '#d06bd0',
  event: '#e05b6b',
  concept: '#4bb6d0',
};

export const FALLBACK_ENTITY_COLOR = '#9aa0aa';

export function entityColor(entityType: string): string {
  return ENTITY_TYPE_COLORS[entityType.toLowerCase()] ?? FALLBACK_ENTITY_COLOR;
}
