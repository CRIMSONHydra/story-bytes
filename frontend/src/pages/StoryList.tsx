import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

interface Story {
  story_id: string;
  title: string;
  authors: string[];
  language: string;
}

export default function StoryList() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:5001/api/stories')
      .then(res => res.json())
      .then(data => {
        setStories(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch stories:', err);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading">Loading stories...</div>;

  return (
    <div className="story-list">
      <h2>Available Stories</h2>
      <div className="grid">
        {stories.map(story => (
          <Link key={story.story_id} to={`/story/${story.story_id}/chapter/1`} className="card story-card">
            <h3>{story.title}</h3>
            <p>{story.authors.join(', ')}</p>
            <span className="lang-tag">{story.language}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
