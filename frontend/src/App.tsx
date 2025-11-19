import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import StoryList from './pages/StoryList';
import Reader from './pages/Reader';

function App() {
  return (
    <Router>
      <div className="app-container">
        <header>
          <h1>Story Bytes</h1>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<StoryList />} />
            <Route path="/story/:storyId/chapter/:chapterId" element={<Reader />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
