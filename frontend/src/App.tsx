import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import './App.css';
import StoryList from './pages/StoryList';
import Reader from './pages/Reader';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import RecapPage from './pages/RecapPage';
import ChapterManager from './pages/ChapterManager';
import CastPage from './pages/CastPage';
import { ProfilePicker } from './components/ProfilePicker';

// Lazy-loaded so the heavy vis-network dependency is only fetched when a reader
// actually opens the knowledge graph.
const GraphPage = lazy(() => import('./pages/GraphPage'));

function App() {
  return (
    <Router>
      <div className="app-container">
        <header>
          <Link to="/" className="home-link"><h1>Story Bytes</h1></Link>
          <nav className="nav-links">
            <Link to="/">Home</Link>
            <Link to="/chat">Chat</Link>
            <Link to="/admin">Admin</Link>
            {/* Switching profiles reloads so all scoped views (progress, chat) refetch as the new user. */}
            <ProfilePicker onChange={() => window.location.reload()} />
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<StoryList />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/story/:storyId/recap" element={<RecapPage />} />
            <Route path="/story/:storyId/manage" element={<ChapterManager />} />
            <Route path="/story/:storyId/cast" element={<CastPage />} />
            <Route
              path="/story/:storyId/graph"
              element={
                <Suspense fallback={<div className="loading">Loading graph...</div>}>
                  <GraphPage />
                </Suspense>
              }
            />
            <Route path="/story/:storyId/chapter/:chapterId" element={<Reader />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
