import { useEffect, useState } from 'react';
import ChatInterface from '../components/ChatInterface';

import { API_BASE } from '../config';

interface SeriesInfo {
  series_title: string;
  story_count: number;
  first_story_id: string;
}

interface SeriesVolume {
  story_id: string;
  story_title: string;
  chapters: { chapter_order: number; title: string }[];
}

export default function ChatPage() {
  const [seriesList, setSeriesList] = useState<SeriesInfo[]>([]);
  const [selectedSeries, setSelectedSeries] = useState<string>('');
  const [volumes, setVolumes] = useState<SeriesVolume[]>([]);
  const [spoilerStoryId, setSpoilerStoryId] = useState<string | undefined>();
  const [spoilerChapter, setSpoilerChapter] = useState<number | undefined>();

  // Fetch available series
  useEffect(() => {
    fetch(`${API_BASE}/api/series`)
      .then(res => { if (!res.ok) throw new Error('Failed'); return res.json(); })
      .then((data: SeriesInfo[]) => { if (Array.isArray(data)) setSeriesList(data); })
      .catch(() => {});
  }, []);

  // Fetch volumes+chapters when series changes
  useEffect(() => {
    if (!selectedSeries) return;
    const series = seriesList.find(s => s.series_title === selectedSeries);
    if (!series) return;

    fetch(`${API_BASE}/api/stories/${series.first_story_id}/series-chapters`)
      .then(res => { if (!res.ok) throw new Error('Failed'); return res.json(); })
      .then((data: SeriesVolume[]) => {
        if (!Array.isArray(data)) return;
        setVolumes(data);
        // Default spoiler to last chapter of last volume
        const lastVol = data[data.length - 1];
        if (lastVol?.chapters.length) {
          const lastCh = lastVol.chapters[lastVol.chapters.length - 1];
          setSpoilerStoryId(lastVol.story_id);
          setSpoilerChapter(lastCh.chapter_order);
        }
      })
      .catch(() => {});
  }, [selectedSeries, seriesList]);

  const handleSeriesChange = (series: string) => {
    setSelectedSeries(series);
    if (!series) {
      setVolumes([]);
      setSpoilerStoryId(undefined);
      setSpoilerChapter(undefined);
    }
  };

  const handleSpoilerChange = (value: string) => {
    const [sid, ch] = value.split(':');
    setSpoilerStoryId(sid);
    setSpoilerChapter(Number(ch));
  };

  // Count total chapters across all volumes
  const totalChapters = volumes.reduce((sum, v) => sum + v.chapters.length, 0);

  return (
    <div className="chat-page">
      <div className="chat-page-selectors">
        <select
          value={selectedSeries}
          onChange={e => handleSeriesChange(e.target.value)}
        >
          <option value="">General chat (no story)</option>
          {seriesList.map(s => (
            <option key={s.series_title} value={s.series_title}>
              {s.series_title} ({s.story_count} vol{s.story_count > 1 ? 's' : ''})
            </option>
          ))}
        </select>
        {volumes.length > 0 && (
          <select
            value={spoilerStoryId && spoilerChapter !== undefined ? `${spoilerStoryId}:${spoilerChapter}` : ''}
            onChange={e => handleSpoilerChange(e.target.value)}
          >
            {volumes.map((vol, vi) => (
              <optgroup key={vol.story_id} label={`Vol. ${vi + 1}: ${vol.story_title}`}>
                {vol.chapters.map(ch => (
                  <option key={`${vol.story_id}:${ch.chapter_order}`} value={`${vol.story_id}:${ch.chapter_order}`}>
                    {ch.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>
      <div className="chat-page-body">
        <ChatInterface
          storyId={spoilerStoryId}
          currentChapter={spoilerChapter}
          totalChapters={totalChapters}
        />
      </div>
    </div>
  );
}
