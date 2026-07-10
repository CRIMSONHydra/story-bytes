import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { API_BASE } from '../config';
import StoryGraph from '../components/StoryGraph';
import { ENTITY_TYPE_COLORS, entityColor } from '../components/entityGraph';
import type { GraphEdge, GraphEntity } from '../components/entityGraph';
import EntityPanel from '../components/EntityPanel';
import './Graph.css';

interface GraphResponse {
  entities: GraphEntity[];
  edges: GraphEdge[];
  generatedUpTo: number;
}

interface EntityListItem {
  entityId: string;
  entityType: string;
  name: string;
  aliases: string[];
  latestState: string | null;
  firstChapter: number;
}

interface ThreadBeat {
  kind: string;
  chapter: number;
  description: string;
}

interface Thread {
  threadId: string;
  name: string;
  status: 'open' | 'resolved';
  beats: ThreadBeat[];
}

interface StoryMeta {
  story_id: string;
  title: string;
}

const SEARCH_DEBOUNCE_MS = 300;
const SLIDER_DEBOUNCE_MS = 300;

export default function GraphPage() {
  const { storyId } = useParams();
  const [searchParams] = useSearchParams();
  const upToParam = searchParams.get('upTo');
  const initialUpTo = upToParam !== null && Number.isFinite(Number(upToParam)) ? Number(upToParam) : null;

  const [story, setStory] = useState<StoryMeta | null>(null);
  const [maxChapter, setMaxChapter] = useState<number | null>(null);

  // sliderValue drives the range input immediately for a smooth drag; the graph
  // is (re)fetched off debouncedUpTo. Both are null until we know a default
  // (from ?upTo or reading progress) — set asynchronously so nothing calls
  // setState synchronously inside an effect.
  const [sliderValue, setSliderValue] = useState<number | null>(initialUpTo);
  const [debouncedUpTo, setDebouncedUpTo] = useState<number | null>(initialUpTo);
  const sliderTimeoutRef = useRef<number | null>(null);

  const [result, setResult] = useState<{ key: string; graph: GraphResponse } | null>(null);
  const [errState, setErrState] = useState<{ key: string; message: string } | null>(null);

  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<EntityListItem[]>([]);
  const searchTimeoutRef = useRef<number | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const [showThreads, setShowThreads] = useState(false);
  const [threadsResult, setThreadsResult] = useState<{ key: string; threads: Thread[] } | null>(null);

  const requestKey = `${storyId ?? ''}|${debouncedUpTo ?? ''}`;

  // Story metadata for the header title.
  useEffect(() => {
    if (!storyId) return;
    const controller = new AbortController();
    fetch(`${API_BASE}/api/stories/${storyId}`, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`Story fetch failed: ${res.status}`); return res.json(); })
      .then((data: StoryMeta) => setStory(data))
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to load story:', err); });
    return () => controller.abort();
  }, [storyId]);

  // Chapter list gives us the slider max; reading progress seeds the default
  // slider position when no ?upTo was supplied. Both land in async
  // continuations, tagged where needed, so the effect body stays side-effect
  // free for the set-state-in-effect rule.
  useEffect(() => {
    if (!storyId) return;
    const controller = new AbortController();

    fetch(`${API_BASE}/api/stories/${storyId}/chapters`, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`Chapters fetch failed: ${res.status}`); return res.json(); })
      .then((chapters: { chapter_order: number }[]) => {
        const max = chapters.reduce((acc, c) => Math.max(acc, c.chapter_order), 0);
        setMaxChapter(max);
      })
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to load chapters:', err); });

    if (initialUpTo === null) {
      fetch(`${API_BASE}/api/stories/${storyId}/progress`, { signal: controller.signal })
        .then(res => (res.ok ? res.json() : null))
        .then((prog: { lastChapterOrder?: number } | null) => {
          const start = prog?.lastChapterOrder && prog.lastChapterOrder > 0 ? prog.lastChapterOrder : 0;
          setSliderValue(prev => (prev === null ? start : prev));
          setDebouncedUpTo(prev => (prev === null ? start : prev));
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          setSliderValue(prev => (prev === null ? 0 : prev));
          setDebouncedUpTo(prev => (prev === null ? 0 : prev));
        });
    }

    return () => controller.abort();
  }, [storyId, initialUpTo]);

  // Fetch the graph for the current spoiler chapter.
  const loadGraph = useCallback(() => {
    if (!storyId || debouncedUpTo === null) return;
    const controller = new AbortController();
    const key = `${storyId}|${debouncedUpTo}`;
    const url = `${API_BASE}/api/stories/${storyId}/graph?upToChapter=${debouncedUpTo}`;

    fetch(url, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`Graph fetch failed: ${res.status}`); return res.json(); })
      .then((data: GraphResponse) => setResult({ key, graph: data }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        console.error('Failed to load graph:', err);
        setErrState({ key, message: 'Could not load the story graph. Please try again.' });
      });

    return () => controller.abort();
  }, [storyId, debouncedUpTo]);

  useEffect(loadGraph, [loadGraph]);

  // Threads for the current spoiler chapter — only fetched while the panel is open.
  const loadThreads = useCallback(() => {
    if (!showThreads || !storyId || debouncedUpTo === null) return;
    const controller = new AbortController();
    const key = `${storyId}|${debouncedUpTo}`;
    fetch(`${API_BASE}/api/stories/${storyId}/threads?upToChapter=${debouncedUpTo}`, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`Threads fetch failed: ${res.status}`); return res.json(); })
      .then((data: { threads: Thread[] }) => setThreadsResult({ key, threads: data.threads }))
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to load threads:', err); });
    return () => controller.abort();
  }, [showThreads, storyId, debouncedUpTo]);

  useEffect(loadThreads, [loadThreads]);

  const handleSliderChange = (value: number) => {
    setSliderValue(value);
    setSelectedEntityId(null);
    if (sliderTimeoutRef.current) clearTimeout(sliderTimeoutRef.current);
    sliderTimeoutRef.current = window.setTimeout(() => setDebouncedUpTo(value), SLIDER_DEBOUNCE_MS);
  };

  const runSearch = useCallback((q: string) => {
    searchAbortRef.current?.abort();
    if (!q.trim() || !storyId || debouncedUpTo === null) {
      setSearchResults([]);
      return;
    }
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const params = new URLSearchParams({ upToChapter: String(debouncedUpTo), q: q.trim() });
    fetch(`${API_BASE}/api/stories/${storyId}/entities?${params.toString()}`, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`Entity search failed: ${res.status}`); return res.json(); })
      .then((data: { entities: EntityListItem[] }) => setSearchResults(data.entities))
      .catch(err => { if (err.name !== 'AbortError') console.error('Entity search failed:', err); });
  }, [storyId, debouncedUpTo]);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = window.setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
  };

  const handleSelectResult = (entityId: string) => {
    setFocusEntityId(entityId);
    setSelectedEntityId(entityId);
    setSearchInput('');
    setSearchResults([]);
  };

  // Derive view state during render from the tagged responses.
  const initializing = debouncedUpTo === null;
  const graph = result?.key === requestKey ? result.graph : null;
  const error = errState?.key === requestKey ? errState.message : null;
  const loading = !initializing && !graph && !error;
  const threads = threadsResult?.key === requestKey ? threadsResult.threads : null;

  const sliderMax = maxChapter ?? Math.max(sliderValue ?? 1, debouncedUpTo ?? 1, 1);
  const displayChapter = sliderValue ?? debouncedUpTo ?? 0;
  const hasEntities = !!graph && graph.entities.length > 0;

  const legendTypes = graph
    ? Array.from(new Set(graph.entities.map(e => e.entityType.toLowerCase())))
    : [];

  return (
    <div className="graph-page">
      <header className="graph-header">
        <div className="graph-heading">
          <h2>{story?.title ?? 'Knowledge graph'}</h2>
          <span className="graph-subtitle">Character &amp; relationship map</span>
        </div>
        <Link to={`/story/${storyId}/chapter/${displayChapter || 0}`} className="graph-back-link">
          Back to reading &rarr;
        </Link>
      </header>

      <div className="graph-controls">
        <div className="graph-slider-block">
          <label htmlFor="graph-spoiler-slider">
            Spoilers up to <strong>Chapter {displayChapter}</strong>
          </label>
          <input
            id="graph-spoiler-slider"
            type="range"
            min={0}
            max={sliderMax}
            value={displayChapter}
            onChange={e => handleSliderChange(Number(e.target.value))}
            disabled={initializing}
          />
        </div>

        <div className="graph-search-block">
          <input
            type="text"
            className="graph-search-input"
            aria-label="Search characters, factions"
            placeholder="Search characters, factions..."
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            disabled={initializing}
          />
          {searchResults.length > 0 && (
            <ul className="graph-search-results">
              {searchResults.map(entity => (
                <li key={entity.entityId}>
                  <button type="button" onClick={() => handleSelectResult(entity.entityId)}>
                    <span
                      className="entity-type-dot"
                      style={{ backgroundColor: entityColor(entity.entityType) }}
                    />
                    <span className="graph-search-name">{entity.name}</span>
                    <span className="graph-search-type">{entity.entityType}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          className={`graph-threads-toggle ${showThreads ? 'active' : ''}`}
          onClick={() => setShowThreads(v => !v)}
        >
          {showThreads ? 'Hide threads' : 'Show threads'}
        </button>
      </div>

      {legendTypes.length > 0 && (
        <div className="graph-legend">
          {legendTypes.map(type => (
            <span key={type} className="graph-legend-item">
              <span className="entity-type-dot" style={{ backgroundColor: ENTITY_TYPE_COLORS[type] ?? '#9aa0aa' }} />
              {type}
            </span>
          ))}
          <span className="graph-legend-item graph-legend-dashed">
            <span className="graph-legend-line" /> ended relationship
          </span>
        </div>
      )}

      <div className="graph-main">
        <div className="graph-stage">
          {initializing && <p className="graph-status">Loading graph...</p>}
          {loading && <p className="graph-status">Loading graph...</p>}
          {!loading && !initializing && error && <p className="graph-status graph-error">{error}</p>}
          {!loading && !initializing && !error && !hasEntities && (
            <p className="graph-status">No graph data for this story yet.</p>
          )}
          {hasEntities && graph && (
            <StoryGraph
              entities={graph.entities}
              edges={graph.edges}
              onSelectEntity={setSelectedEntityId}
              focusEntityId={focusEntityId}
            />
          )}
        </div>

        {selectedEntityId && storyId && debouncedUpTo !== null && (
          <EntityPanel
            storyId={storyId}
            entityId={selectedEntityId}
            upToChapter={debouncedUpTo}
            onClose={() => setSelectedEntityId(null)}
          />
        )}
      </div>

      {showThreads && (
        <section className="graph-threads">
          <h3>Narrative threads</h3>
          {!threads && <p className="graph-status">Loading threads...</p>}
          {threads && threads.length === 0 && (
            <p className="graph-status">No tracked threads yet.</p>
          )}
          {threads && threads.length > 0 && (
            <ul className="graph-thread-list">
              {threads.map(thread => {
                const latest = thread.beats[thread.beats.length - 1];
                return (
                  <li key={thread.threadId} className={`graph-thread ${thread.status}`}>
                    <div className="graph-thread-head">
                      <span className="graph-thread-name">{thread.name}</span>
                      <span className={`graph-thread-status ${thread.status}`}>{thread.status}</span>
                    </div>
                    {latest && (
                      <p className="graph-thread-beat">
                        <span className="entity-chapter-tag">Ch. {latest.chapter}</span> {latest.description}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
