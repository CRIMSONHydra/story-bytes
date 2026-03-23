import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface ChatInterfaceProps {
  storyId?: string;
  currentChapter?: number;
  totalChapters?: number;
}

interface ChatSource {
  chapterOrder: number;
  blockId: string;
  title: string;
}

interface ChatImage {
  assetId: string;
  href: string;
  description: string;
  storyId?: string;
}

interface Message {
  role: 'user' | 'ai';
  content: string;
  sources?: ChatSource[];
  images?: ChatImage[];
}

type ChatMode = 'recall' | 'foreshadowing' | 'theory';

interface SeriesVolume {
  story_id: string;
  story_title: string;
  chapters: { chapter_order: number; title: string }[];
}

import { API_BASE } from '../config';

export default function ChatInterface({ storyId, currentChapter, totalChapters }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: 'Hi! I can help you recall details, analyze foreshadowing, or discuss theories about this story. Ask me anything!' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ChatMode>('recall');
  const [spoilerStoryId, setSpoilerStoryId] = useState(storyId || '');
  const [spoilerChapter, setSpoilerChapter] = useState(currentChapter || 0);
  const [seriesVolumes, setSeriesVolumes] = useState<SeriesVolume[]>([]);
  const [expandedImages, setExpandedImages] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch series chapters for cross-volume spoiler selector
  useEffect(() => {
    if (!storyId) return;
    fetch(`${API_BASE}/api/stories/${storyId}/series-chapters`)
      .then(res => res.json())
      .then((data: SeriesVolume[]) => {
        if (Array.isArray(data)) setSeriesVolumes(data);
      })
      .catch(() => { /* ignore */ });
  }, [storyId]);

  useEffect(() => {
    if (storyId) setSpoilerStoryId(storyId);
    if (currentChapter !== undefined) setSpoilerChapter(currentChapter);
  }, [storyId, currentChapter]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(scrollToBottom, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMsg,
          storyId: spoilerStoryId,
          currentChapter: spoilerChapter,
          mode,
        })
      });

      if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);
      const data = await res.json();

      setMessages(prev => [...prev, {
        role: 'ai',
        content: data.answer,
        sources: data.sources,
        images: data.images,
      }]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'ai', content: "Sorry, I couldn't reach the server." }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSourceClick = (source: ChatSource) => {
    if (storyId) {
      // In reader mode: scroll to block
      window.location.hash = `#block-${source.blockId}`;
    } else {
      // In standalone mode: navigate to reader
      window.location.href = `/story/${spoilerStoryId}/chapter/${source.chapterOrder}#block-${source.blockId}`;
    }
  };

  return (
    <div className="chat-interface">
      {/* Controls bar */}
      <div className="chat-controls">
        <div className="chat-mode-selector">
          {(['recall', 'foreshadowing', 'theory'] as ChatMode[]).map(m => (
            <button
              key={m}
              className={`mode-btn ${mode === m ? 'active' : ''}`}
              onClick={() => setMode(m)}
              title={m === 'recall' ? 'Ask about what you\'ve read' : m === 'foreshadowing' ? 'Analyze hints and foreshadowing' : 'Discuss theories and speculation'}
            >
              {m === 'recall' ? 'Recall' : m === 'foreshadowing' ? 'Hints' : 'Theory'}
            </button>
          ))}
        </div>
        {storyId && <div className="spoiler-selector">
          <label>Spoiler limit:</label>
          <select
            value={`${spoilerStoryId}:${spoilerChapter}`}
            onChange={e => {
              const [sid, ch] = e.target.value.split(':');
              setSpoilerStoryId(sid);
              setSpoilerChapter(Number(ch));
            }}
          >
            {seriesVolumes.length > 1 ? (
              seriesVolumes.map((vol, vi) => (
                <optgroup key={vol.story_id} label={`Vol. ${vi + 1}`}>
                  {vol.chapters.map(ch => (
                    <option
                      key={`${vol.story_id}:${ch.chapter_order}`}
                      value={`${vol.story_id}:${ch.chapter_order}`}
                    >
                      {ch.title}{vol.story_id === storyId && ch.chapter_order === currentChapter ? ' (current)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))
            ) : (
              Array.from({ length: totalChapters || Math.max((currentChapter ?? 0) + 5, 20) }, (_, i) => i + 1).map(ch => (
                <option key={ch} value={`${storyId}:${ch}`}>
                  Ch. {ch}{ch === currentChapter ? ' (current)' : ''}
                </option>
              ))
            )}
          </select>
        </div>}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="bubble">
              <ReactMarkdown>{msg.content}</ReactMarkdown>

              {/* Source citations */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="chat-sources">
                  <span className="sources-label">Sources:</span>
                  {msg.sources.slice(0, 5).map((src, i) => (
                    <button
                      key={i}
                      className="source-link"
                      onClick={() => handleSourceClick(src)}
                      title={src.title}
                    >
                      Ch. {src.chapterOrder}
                    </button>
                  ))}
                </div>
              )}

              {/* Image gallery */}
              {msg.images && msg.images.length > 0 && (
                <div className="chat-images">
                  {msg.images.map((img, imgIdx) => {
                    const imgKey = img.assetId || `ch-img-${imgIdx}`;
                    const imgStoryId = img.storyId || storyId;
                    const imgSrc = img.assetId
                      ? `${API_BASE}/api/assets/${img.assetId}/image`
                      : `${API_BASE}/api/stories/${imgStoryId}/image?path=${encodeURIComponent(img.href)}`;
                    return (
                      <div key={imgKey} className="chat-image-thumb">
                        <img
                          src={imgSrc}
                          alt={img.description}
                          onClick={() => setExpandedImages(expandedImages === imgKey ? null : imgKey)}
                        />
                        {expandedImages === imgKey && (
                          <div className="image-expanded" onClick={() => setExpandedImages(null)}>
                            <img src={imgSrc} alt={img.description} />
                            <p>{img.description}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="message ai"><div className="bubble typing">Thinking...</div></div>}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={sendMessage} className="chat-input">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={mode === 'foreshadowing' ? 'Ask about hints and foreshadowing...' : mode === 'theory' ? 'Ask about theories...' : 'Ask about the story...'}
          disabled={loading}
        />
        <button type="submit" disabled={loading}>Send</button>
      </form>
    </div>
  );
}
