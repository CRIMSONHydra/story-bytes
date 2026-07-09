import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { API_BASE } from '../config';
import './Recap.css';

interface RecentChapter {
  chapterOrder: number;
  title: string;
  summary: string;
}

interface LastEvent {
  chapterOrder: number;
  title: string;
  description: string;
}

interface CastMember {
  entityId: string;
  name: string;
  entityType: string;
  latestState: string | null;
}

interface OpenThread {
  name: string;
  latestBeat: string;
}

interface ForeshadowItem {
  setupChapter: number;
  setupSummary: string;
  hint: string;
}

interface RecapResponse {
  storyId: string;
  upToChapter: number;
  storySoFar: string;
  recentChapters: RecentChapter[];
  lastEvent: LastEvent | null;
  mainCast: CastMember[];
  openThreads: OpenThread[];
  foreshadowing: ForeshadowItem[] | null;
  meta: { hasGraph: boolean; foreshadowEnabled: boolean };
}

interface StoryMeta {
  story_id: string;
  title: string;
}

export default function RecapPage() {
  const { storyId } = useParams();
  const [searchParams] = useSearchParams();
  const upTo = searchParams.get('upTo');

  const [story, setStory] = useState<StoryMeta | null>(null);
  const [foreshadow, setForeshadow] = useState(false);
  // Results/errors are tagged with the request key they belong to. loading /
  // error / recap are then derived during render from whether we have a
  // response for the *current* request, so nothing has to setState
  // synchronously inside the fetch effect (which would cascade renders).
  const [result, setResult] = useState<{ key: string; recap: RecapResponse } | null>(null);
  const [errState, setErrState] = useState<{ key: string; message: string } | null>(null);

  const requestKey = `${storyId ?? ''}|${upTo ?? ''}|${foreshadow ? '1' : '0'}`;

  // Fetch story metadata for the header title.
  useEffect(() => {
    if (!storyId) return;
    const controller = new AbortController();
    fetch(`${API_BASE}/api/stories/${storyId}`, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`Story fetch failed: ${res.status}`); return res.json(); })
      .then((data: StoryMeta) => setStory(data))
      .catch(err => { if (err.name !== 'AbortError') console.error('Failed to load story:', err); });
    return () => controller.abort();
  }, [storyId]);

  // Fetch the recap and return the AbortController cleanup. Used directly as the
  // effect callback so nothing runs synchronously in an inline effect body; all
  // state updates happen in the async continuations, tagged with the request
  // key. AbortController cancels in-flight requests on unmount / re-fetch so
  // stale responses never land. Re-created (re-running the effect) when
  // storyId, upTo, or the foreshadowing toggle change.
  const loadRecap = useCallback(() => {
    if (!storyId) return;
    const controller = new AbortController();
    const key = `${storyId}|${upTo ?? ''}|${foreshadow ? '1' : '0'}`;

    const params = new URLSearchParams();
    if (upTo) params.set('upToChapter', upTo);
    if (foreshadow) params.set('foreshadow', '1');
    const qs = params.toString();
    const url = `${API_BASE}/api/stories/${storyId}/recap${qs ? `?${qs}` : ''}`;

    fetch(url, { signal: controller.signal })
      .then(res => { if (!res.ok) throw new Error(`Recap fetch failed: ${res.status}`); return res.json(); })
      .then((data: RecapResponse) => setResult({ key, recap: data }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        console.error('Failed to load recap:', err);
        setErrState({ key, message: 'Could not load your recap. Please try again.' });
      });

    return () => controller.abort();
  }, [storyId, upTo, foreshadow]);

  useEffect(loadRecap, [loadRecap]);

  // Derive view state from whether we have a response for the current request.
  const recap = result?.key === requestKey ? result.recap : null;
  const error = errState?.key === requestKey ? errState.message : null;
  const loading = !recap && !error;

  const asOfChapter = recap?.upToChapter ?? (upTo ? Number(upTo) : undefined);
  const continueChapter = recap?.upToChapter ?? (upTo ? Number(upTo) : 0);
  const readerPath = `/story/${storyId}/chapter/${continueChapter || 0}`;

  const storySoFar = recap?.storySoFar?.trim();
  const hasRecent = !!recap?.recentChapters?.length;
  const hasCast = !!recap?.mainCast?.length;
  const hasThreads = !!recap?.openThreads?.length;
  const foreshadowItems = foreshadow ? recap?.foreshadowing ?? [] : [];
  const hasForeshadow = foreshadow && foreshadowItems.length > 0;
  const graphMissing = recap ? !recap.meta.hasGraph : false;

  const hasAnyContent =
    !!storySoFar || hasRecent || !!recap?.lastEvent || hasCast || hasThreads;

  return (
    <div className="recap-page">
      <header className="recap-header">
        <div className="recap-heading">
          <h2>{story?.title ?? 'Recap'}</h2>
          {asOfChapter !== undefined && (
            <span className="recap-as-of">as of chapter {asOfChapter}</span>
          )}
        </div>
        <div className="recap-actions">
          <label className="recap-toggle">
            <input
              type="checkbox"
              checked={foreshadow}
              onChange={e => setForeshadow(e.target.checked)}
            />
            <span>Highlight foreshadowing</span>
          </label>
          <Link to={readerPath} className="recap-continue">Back to reading &rarr;</Link>
        </div>
      </header>

      {loading && <p className="recap-status">Preparing your recap...</p>}

      {!loading && error && (
        <p className="recap-status recap-error">{error}</p>
      )}

      {!loading && !error && recap && (
        <div className="recap-body">
          {!hasAnyContent && !graphMissing && (
            <p className="recap-status">Nothing to recap yet — start reading to build your catch-up.</p>
          )}

          {storySoFar && (
            <section className="recap-section">
              <h3>Story so far</h3>
              <p className="recap-prose">{storySoFar}</p>
            </section>
          )}

          {hasRecent && (
            <section className="recap-section">
              <h3>Since you were last here</h3>
              <ul className="recap-recent">
                {recap.recentChapters.map(ch => (
                  <li key={ch.chapterOrder} className="recap-recent-item">
                    <div className="recap-recent-head">
                      <span className="recap-chapter-tag">Ch. {ch.chapterOrder}</span>
                      <span className="recap-recent-title">{ch.title}</span>
                    </div>
                    <p className="recap-recent-summary">{ch.summary}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {recap.lastEvent && (
            <section className="recap-section">
              <h3>Where you left off</h3>
              <div className="recap-last-event">
                <div className="recap-recent-head">
                  <span className="recap-chapter-tag">Ch. {recap.lastEvent.chapterOrder}</span>
                  <span className="recap-recent-title">{recap.lastEvent.title}</span>
                </div>
                <p className="recap-prose">{recap.lastEvent.description}</p>
              </div>
            </section>
          )}

          {hasCast && (
            <section className="recap-section">
              <h3>Main cast right now</h3>
              <div className="recap-cast-grid">
                {recap.mainCast.map(member => (
                  <div key={member.entityId} className="recap-cast-card">
                    <div className="recap-cast-head">
                      <span className="recap-cast-name">{member.name}</span>
                      <span className="recap-cast-type">{member.entityType}</span>
                    </div>
                    {member.latestState && (
                      <p className="recap-cast-state">{member.latestState}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasThreads && (
            <section className="recap-section">
              <h3>Open questions</h3>
              <ul className="recap-threads">
                {recap.openThreads.map(thread => (
                  <li key={thread.name} className="recap-thread-item">
                    <span className="recap-thread-name">{thread.name}</span>
                    <span className="recap-thread-beat">{thread.latestBeat}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasForeshadow && (
            <section className="recap-section recap-foreshadow-section">
              <h3>Threads worth keeping an eye on</h3>
              <div className="recap-foreshadow-list">
                {foreshadowItems.map((item, i) => (
                  <div key={`${item.setupChapter}-${i}`} className="recap-foreshadow-item">
                    <span className="recap-foreshadow-tag">Set up in Ch. {item.setupChapter}</span>
                    <p className="recap-foreshadow-setup">{item.setupSummary}</p>
                    <p className="recap-foreshadow-hint">{item.hint}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {graphMissing && (
            <p className="recap-note">
              Character &amp; thread data not yet generated for this story.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
