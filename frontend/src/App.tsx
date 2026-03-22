import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import './App.css';
import StoryList from './pages/StoryList';
import Reader from './pages/Reader';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';

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
          </nav>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<StoryList />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/story/:storyId/chapter/:chapterId" element={<Reader />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
