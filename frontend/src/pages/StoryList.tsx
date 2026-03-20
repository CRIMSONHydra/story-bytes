import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = 'http://localhost:5001';

interface Story {
  story_id: string;
  title: string;
  authors: string[];
  language: string;
  content_type: 'novel' | 'comic' | 'manga';
}

interface SeriesGroup {
  seriesTitle: string;
  stories: Story[];
  contentType: string;
  authors: string[];
  language: string;
}

interface Progress {
  [storyId: string]: number;
}

/**
 * Extract a series title by stripping volume/number suffixes.
 */
function extractSeriesTitle(title: string): string {
  return title
    .replace(/[-:]\s*(Volume|Vol\.?)\s*\d+.*$/i, '')
    .replace(/\s*(Volume|Vol\.?)\s*\d+.*$/i, '')
    .replace(/\s*[-–—]\s*$/, '')
    .trim();
}

function groupBySeries(stories: Story[]): SeriesGroup[] {
  const groups = new Map<string, Story[]>();

  for (const story of stories) {
    const key = extractSeriesTitle(story.title);
    const list = groups.get(key) || [];
    list.push(story);
    groups.set(key, list);
  }

  return Array.from(groups.entries()).map(([seriesTitle, stories]) => ({
    seriesTitle,
    stories: stories.sort((a, b) => a.title.localeCompare(b.title)),
    contentType: stories[0].content_type,
    authors: stories[0].authors,
    language: stories[0].language,
  }));
}

export default function StoryList() {
  const [stories, setStories] = useState<Story[]>([]);
  const [progress, setProgress] = useState<Progress>({});
  const [loading, setLoading] = useState(true);
  const [expandedSeries, setExpandedSeries] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/stories`)
      .then(res => {
        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        return res.json();
      })
      .then(async (data: unknown) => {
        if (!Array.isArray(data)) {
          console.error('Expected array from /api/stories, got:', data);
          setLoading(false);
          return;
        }
        setStories(data as Story[]);

        const progressMap: Progress = {};
        await Promise.all(
          (data as Story[]).map(async (story) => {
            try {
              const res = await fetch(`${API_BASE}/api/stories/${story.story_id}/progress`);
              if (!res.ok) return;
              const prog = await res.json();
              if (prog.lastChapterOrder > 0) {
                progressMap[story.story_id] = prog.lastChapterOrder;
              }
            } catch { /* ignore */ }
          })
        );
        setProgress(progressMap);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch stories:', err);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading">Loading stories...</div>;

  const series = groupBySeries(stories);

  return (
    <div className="story-list">
      <h2>Available Stories</h2>
      <div className="grid">
        {series.map(group => {
          const isExpanded = expandedSeries === group.seriesTitle;
          const isSingle = group.stories.length === 1;

          // For single stories, link directly
          if (isSingle) {
            const story = group.stories[0];
            const lastCh = progress[story.story_id];
            return (
              <Link
                key={story.story_id}
                to={`/story/${story.story_id}/chapter/${lastCh || 1}`}
                className="card story-card"
              >
                <div className="card-header">
                  <h3>{story.title}</h3>
                  <span className={`type-tag type-${story.content_type}`}>
                    {story.content_type}
                  </span>
                </div>
                <p>{story.authors.join(', ')}</p>
                <div className="card-footer">
                  <span className="lang-tag">{story.language}</span>
                  {lastCh && <span className="progress-tag">Continue Ch. {lastCh}</span>}
                </div>
              </Link>
            );
          }

          // For multi-volume series
          return (
            <div key={group.seriesTitle} className="card series-card">
              <div
                className="series-header"
                onClick={() => setExpandedSeries(isExpanded ? null : group.seriesTitle)}
              >
                <div className="card-header">
                  <h3>{group.seriesTitle}</h3>
                  <span className={`type-tag type-${group.contentType}`}>
                    {group.contentType}
                  </span>
                </div>
                <p>{group.authors.join(', ')}</p>
                <div className="card-footer">
                  <span className="lang-tag">{group.language}</span>
                  <span className="volume-count">{group.stories.length} volumes</span>
                </div>
              </div>

              {isExpanded && (
                <div className="volume-list">
                  {group.stories.map((story, i) => {
                    const lastCh = progress[story.story_id];
                    return (
                      <Link
                        key={story.story_id}
                        to={`/story/${story.story_id}/chapter/${lastCh || 1}`}
                        className="volume-item"
                      >
                        <span className="volume-number">Vol. {i + 1}</span>
                        <span className="volume-title">{story.title}</span>
                        {lastCh && <span className="progress-tag">Ch. {lastCh}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
