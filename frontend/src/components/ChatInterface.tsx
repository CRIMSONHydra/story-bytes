import { useState, useRef, useEffect } from 'react';

interface ChatInterfaceProps {
  storyId: string;
  currentChapter: number;
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
}

interface Message {
  role: 'user' | 'ai';
  content: string;
  sources?: ChatSource[];
  images?: ChatImage[];
}

type ChatMode = 'recall' | 'foreshadowing' | 'theory';

const API_BASE = 'http://localhost:5001';

export default function ChatInterface({ storyId, currentChapter, totalChapters }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: 'Hi! I can help you recall details, analyze foreshadowing, or discuss theories about this story. Ask me anything!' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ChatMode>('recall');
  const [spoilerLimit, setSpoilerLimit] = useState(currentChapter);
  const [expandedImages, setExpandedImages] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSpoilerLimit(currentChapter);
  }, [currentChapter]);

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
          storyId,
          currentChapter: spoilerLimit,
          mode,
        })
      });

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
    // Navigate to the chapter/block
    window.location.hash = `#block-${source.blockId}`;
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
        <div className="spoiler-selector">
          <label>Spoiler limit:</label>
          <select
            value={spoilerLimit}
            onChange={e => setSpoilerLimit(Number(e.target.value))}
          >
            {Array.from({ length: totalChapters || Math.max(currentChapter + 5, 20) }, (_, i) => i + 1).map(ch => (
              <option key={ch} value={ch}>
                Ch. {ch}{ch === currentChapter ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="bubble">
              {msg.content}

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
                  {msg.images.map(img => (
                    <div key={img.assetId} className="chat-image-thumb">
                      <img
                        src={`${API_BASE}/api/assets/${img.assetId}/image`}
                        alt={img.description}
                        onClick={() => setExpandedImages(expandedImages === img.assetId ? null : img.assetId)}
                      />
                      {expandedImages === img.assetId && (
                        <div className="image-expanded" onClick={() => setExpandedImages(null)}>
                          <img src={`${API_BASE}/api/assets/${img.assetId}/image`} alt={img.description} />
                          <p>{img.description}</p>
                        </div>
                      )}
                    </div>
                  ))}
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
