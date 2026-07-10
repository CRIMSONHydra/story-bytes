import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { API_BASE } from '../config';
import { entityColor } from './entityGraph';

interface EntityDetail {
  entity: {
    entityId: string;
    entityType: string;
    name: string;
    aliases: string[];
    description: string | null;
    firstChapter: number;
  };
  states: { chapter: number; description: string; status: string | null }[];
  edges: {
    relId: string;
    sourceId: string;
    targetId: string;
    relType: string;
    description: string | null;
    sinceChapter: number;
    untilChapter: number | null;
  }[];
  events: { eventId: string; chapter: number; title: string; eventType: string | null; role: string }[];
  evidence: { chapter: number; quote: string | null; blockId: string | null }[];
}

interface EntityPanelProps {
  storyId: string;
  entityId: string;
  upToChapter: number;
  onClose: () => void;
}

interface ErrorState {
  key: string;
  message: string;
  notFound: boolean;
}

/**
 * Side panel for a selected entity. Fetches EntityDetail scoped to the current
 * spoiler chapter. Loading/error/detail are derived during render from whether
 * the tagged response matches the current request key — mirroring RecapPage so
 * no setState runs synchronously inside the fetch effect.
 */
export default function EntityPanel({ storyId, entityId, upToChapter, onClose }: EntityPanelProps) {
  const [result, setResult] = useState<{ key: string; detail: EntityDetail } | null>(null);
  const [errState, setErrState] = useState<ErrorState | null>(null);

  const requestKey = `${entityId}|${upToChapter}`;

  const loadDetail = useCallback(() => {
    const controller = new AbortController();
    const key = `${entityId}|${upToChapter}`;
    const url = `${API_BASE}/api/entities/${entityId}?upToChapter=${upToChapter}`;

    fetch(url, { signal: controller.signal })
      .then(res => {
        if (res.status === 404) {
          const notFound = new Error('not-revealed');
          notFound.name = 'NotRevealedError';
          throw notFound;
        }
        if (!res.ok) throw new Error(`Entity fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data: EntityDetail) => setResult({ key, detail: data }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        if (err.name === 'NotRevealedError') {
          setErrState({ key, message: 'This entity has not been revealed yet at your current chapter.', notFound: true });
          return;
        }
        console.error('Failed to load entity:', err);
        setErrState({ key, message: 'Could not load this entity. Please try again.', notFound: false });
      });

    return () => controller.abort();
  }, [entityId, upToChapter]);

  useEffect(loadDetail, [loadDetail]);

  const detail = result?.key === requestKey ? result.detail : null;
  const error = errState?.key === requestKey ? errState : null;
  const loading = !detail && !error;

  return (
    <aside className="entity-panel">
      <button className="entity-panel-close" onClick={onClose} aria-label="Close entity panel">
        &times;
      </button>

      {loading && <p className="graph-status">Loading entity...</p>}

      {error && <p className={`graph-status ${error.notFound ? '' : 'graph-error'}`}>{error.message}</p>}

      {detail && (
        <div className="entity-panel-body">
          <header className="entity-panel-head">
            <span
              className="entity-type-dot"
              style={{ backgroundColor: entityColor(detail.entity.entityType) }}
            />
            <div>
              <h3>{detail.entity.name}</h3>
              <span className="entity-panel-type">{detail.entity.entityType}</span>
              <span className="entity-panel-first">First seen Ch. {detail.entity.firstChapter}</span>
            </div>
          </header>

          {detail.entity.aliases.length > 0 && (
            <div className="entity-aliases">
              {detail.entity.aliases.map(alias => (
                <span key={alias} className="entity-alias-chip">{alias}</span>
              ))}
            </div>
          )}

          {detail.entity.description && (
            <p className="entity-description">{detail.entity.description}</p>
          )}

          {detail.states.length > 0 && (
            <section className="entity-section">
              <h4>State timeline</h4>
              <ul className="entity-timeline">
                {detail.states.map((state, i) => (
                  <li key={`${state.chapter}-${i}`} className="entity-timeline-item">
                    <span className="entity-chapter-tag">Ch. {state.chapter}</span>
                    <div className="entity-timeline-body">
                      {state.status && <span className="entity-status">{state.status}</span>}
                      <p>{state.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.edges.length > 0 && (
            <section className="entity-section">
              <h4>Relationships</h4>
              <ul className="entity-rels">
                {detail.edges.map(edge => {
                  const outgoing = edge.sourceId === detail.entity.entityId;
                  return (
                    <li key={edge.relId} className={`entity-rel ${edge.untilChapter !== null ? 'ended' : ''}`}>
                      <span className="entity-rel-type">
                        {outgoing ? '→' : '←'} {edge.relType}
                      </span>
                      {edge.description && <span className="entity-rel-desc">{edge.description}</span>}
                      <span className="entity-rel-meta">
                        since Ch. {edge.sinceChapter}
                        {edge.untilChapter !== null && ` · ended Ch. ${edge.untilChapter}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {detail.events.length > 0 && (
            <section className="entity-section">
              <h4>Events</h4>
              <ul className="entity-events">
                {detail.events.map(event => (
                  <li key={event.eventId} className="entity-event">
                    <span className="entity-chapter-tag">Ch. {event.chapter}</span>
                    <div className="entity-event-body">
                      <span className="entity-event-title">{event.title}</span>
                      <span className="entity-event-meta">
                        {[event.eventType, event.role].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail.evidence.length > 0 && (
            <section className="entity-section">
              <h4>Evidence</h4>
              <ul className="entity-evidence">
                {detail.evidence.map((item, i) => (
                  <li key={`${item.chapter}-${item.blockId ?? i}`} className="entity-evidence-item">
                    {item.quote && <blockquote>{item.quote}</blockquote>}
                    <Link
                      to={`/story/${storyId}/chapter/${item.chapter}${item.blockId ? `#block-${item.blockId}` : ''}`}
                      className="entity-jump-link"
                    >
                      Jump to Ch. {item.chapter} &rarr;
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
