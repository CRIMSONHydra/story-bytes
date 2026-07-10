import { useEffect, useRef, useState } from 'react';

import { API_BASE } from '../config';
import { submitIngest, getJob, isTerminal, type JobEvent } from '../api/jobs';

const JOB_STORAGE_KEY = 'story-bytes.lastIngestJob';

interface AdminStory {
  story_id: string;
  title: string;
  authors: string[];
  content_type: string;
  series_title: string | null;
  created_at: string;
  chapter_count: number;
  block_count: number;
  embedding_count: number;
  asset_count: number;
}

interface SeriesGroup {
  seriesTitle: string;
  stories: AdminStory[];
  totalChapters: number;
  totalBlocks: number;
  totalEmbeddings: number;
  totalAssets: number;
}

function groupBySeries(stories: AdminStory[]): SeriesGroup[] {
  const groups = new Map<string, AdminStory[]>();

  for (const story of stories) {
    const key = story.series_title || story.title;
    const list = groups.get(key) || [];
    list.push(story);
    groups.set(key, list);
  }

  return Array.from(groups.entries()).map(([seriesTitle, stories]) => ({
    seriesTitle,
    stories: stories.sort((a, b) => a.title.localeCompare(b.title)),
    totalChapters: stories.reduce((s, st) => s + st.chapter_count, 0),
    totalBlocks: stories.reduce((s, st) => s + st.block_count, 0),
    totalEmbeddings: stories.reduce((s, st) => s + st.embedding_count, 0),
    totalAssets: stories.reduce((s, st) => s + st.asset_count, 0),
  }));
}

export default function AdminPage() {
  const [stories, setStories] = useState<AdminStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [jobEvents, setJobEvents] = useState<JobEvent[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [selectedSeries, setSelectedSeries] = useState('');
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStories = () => {
    setLoading(true);
    fetch(`${API_BASE}/api/admin/stories`)
      .then(res => { if (!res.ok) throw new Error('Failed'); return res.json(); })
      .then((data: AdminStory[]) => { setStories(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(fetchStories, []);

  const existingSeries = [...new Set(stories.map(s => s.series_title).filter(Boolean))] as string[];

  const handleDelete = async (storyId: string, title: string) => {
    if (!confirm(`Delete "${title}"? This removes all chapters, embeddings, and assets.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/stories/${storyId}`, { method: 'DELETE' });
      if (res.ok) setStories(prev => prev.filter(s => s.story_id !== storyId));
    } catch {
      alert('Failed to delete story');
    }
  };

  // Poll a job until it reaches a terminal state, streaming its stage events into the UI.
  const pollJob = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setUploading(true);
    const tick = async () => {
      try {
        const { job, events } = await getJob(jobId);
        setJobEvents(events);
        setUploadStatus(`Job ${job.status}${job.error ? `: ${job.error}` : ''}`);
        if (isTerminal(job.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setUploading(false);
          localStorage.removeItem(JOB_STORAGE_KEY);
          if (job.status === 'completed') { setFile(null); setSelectedSeries(''); fetchStories(); }
        }
      } catch {
        /* transient poll error — keep trying */
      }
    };
    void tick();
    pollRef.current = setInterval(() => void tick(), 2000);
  };

  // Resume polling a job that was in flight when the page was last open.
  useEffect(() => {
    const saved = localStorage.getItem(JOB_STORAGE_KEY);
    if (saved) pollJob(saved);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || uploading) return;

    setUploading(true);
    setJobEvents([]);
    setUploadStatus('Uploading…');
    try {
      const accepted = await submitIngest(file, selectedSeries || undefined);
      localStorage.setItem(JOB_STORAGE_KEY, accepted.jobId);
      setUploadStatus(accepted.deduplicated ? 'Already ingested — showing existing job.' : 'Queued. Processing…');
      pollJob(accepted.jobId);
    } catch (error) {
      setUploading(false);
      setUploadStatus(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const seriesGroups = groupBySeries(stories);

  return (
    <div className="admin-page">
      <h2>Story Management</h2>

      <div className="admin-upload">
        <h3>Ingest New Story</h3>
        <form onSubmit={handleUpload} className="upload-form">
          <input
            type="file"
            accept=".epub,.cbz,.cbr"
            onChange={e => setFile(e.target.files?.[0] || null)}
            disabled={uploading}
          />
          <select
            value={selectedSeries}
            onChange={e => setSelectedSeries(e.target.value)}
            disabled={uploading}
            className="series-select"
          >
            <option value="">Auto-detect series</option>
            {existingSeries.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button type="submit" disabled={!file || uploading}>
            {uploading ? 'Processing...' : 'Upload & Ingest'}
          </button>
        </form>
        {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
        {jobEvents.length > 0 && (
          <ul className="upload-events" aria-label="Ingestion progress">
            {jobEvents.map((e, i) => (
              <li key={i} className={`upload-event upload-event--${e.event}`}>
                <span className="upload-event__stage">{e.stage ?? e.event}</span>
                {e.message && <span className="upload-event__msg">{e.message}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="upload-hint">
          Async pipeline: upload returns immediately; extract → embed → tag images → enrich run in the
          background (poll shown above).
        </p>
      </div>

      <div className="admin-stories">
        <h3>Stories ({stories.length})</h3>
        {loading ? (
          <p>Loading...</p>
        ) : seriesGroups.length === 0 ? (
          <p>No stories ingested yet.</p>
        ) : (
          <div className="admin-series-list">
            {seriesGroups.map(group => {
              const isSingle = group.stories.length === 1;
              const isExpanded = expandedSeries === group.seriesTitle;

              return (
                <div key={group.seriesTitle} className="admin-series-group">
                  <div
                    className="admin-series-header"
                    onClick={() => setExpandedSeries(isExpanded ? null : group.seriesTitle)}
                  >
                    <div className="admin-series-title">
                      <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                      <strong>{group.seriesTitle}</strong>
                      {!isSingle && <span className="volume-count">{group.stories.length} volumes</span>}
                      <span className={`type-tag type-${group.stories[0].content_type}`}>
                        {group.stories[0].content_type}
                      </span>
                    </div>
                    <div className="admin-series-counts">
                      <span>{group.totalChapters} ch</span>
                      <span>{group.totalBlocks} blocks</span>
                      <span>{group.totalEmbeddings} emb</span>
                      <span>{group.totalAssets} assets</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="admin-series-volumes">
                      {group.stories.map(story => (
                        <div key={story.story_id} className="admin-volume-row">
                          <span className="admin-vol-title">{story.title}</span>
                          <span className="admin-vol-stat">{story.chapter_count} ch</span>
                          <span className="admin-vol-stat">{story.block_count} blocks</span>
                          <span className="admin-vol-stat">{story.embedding_count} emb</span>
                          <span className="admin-vol-stat">{story.asset_count} assets</span>
                          <button
                            className="delete-btn"
                            onClick={ev => { ev.stopPropagation(); handleDelete(story.story_id, story.title); }}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
