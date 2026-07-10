/**
 * API route definitions.
 * All routes are prefixed with '/api' when mounted in app.ts
 */

import { Router } from 'express';
import { handleChat } from './controllers/chat';
import { handleGetStories, handleGetStory } from './controllers/stories';
import { handleGetChapters, handleGetChapter } from './controllers/chapters';
import { handleSummarize } from './controllers/summary';
import { handleGetRecap } from './controllers/recap';
import { handleGetStoryGraph, handleSearchEntities, handleGetEntity, handleGetThreads } from './controllers/graph';
import { handleGetAssetImage, handleGetStoryImage } from './controllers/assets';
import { handleGetProgress, handleUpdateProgress } from './controllers/progress';
import { handleAdminGetStories, handleAdminDeleteStory, handleAdminIngest, handleGetSeries, handleGetTrace } from './controllers/admin';
import { handleListUsers, handleGetUser, handleCreateUser, handleUpdateUser, handleDeleteUser } from './controllers/users';
import { handleGetJob, handleListJobs, handleCancelJob } from './controllers/jobs';
import { handleGetUsage } from './controllers/usage';
import { upload } from './middleware/upload';
import { adminAuth } from './middleware/adminAuth';
import { chatLimiter, ingestLimiter } from './middleware/rateLimits';
import { asyncHandler } from './middleware/errors';
import { getSeriesChapters } from './services/db';

const router = Router();

// Stories
router.get('/stories', handleGetStories);
router.get('/stories/:id', handleGetStory);
router.get('/stories/:storyId/chapters', handleGetChapters);

// Chapters
router.get('/chapters/:id', handleGetChapter);

// Chat (RAG) — rate-limited (each call fans out to embedding + model inference)
router.post('/chat', chatLimiter, handleChat);

// Summarization (Phase 4)
router.post('/stories/:storyId/summarize', handleSummarize);

// Recap — catch-me-up composition with opt-in foreshadowing emphasis (Improvement Plan §2.12, §2.14)
router.get('/stories/:storyId/recap', handleGetRecap);

// Knowledge graph (M15) — upToChapter required on all; spoiler-gated
router.get('/stories/:storyId/graph', handleGetStoryGraph);
router.get('/stories/:storyId/entities', handleSearchEntities);
router.get('/entities/:entityId', handleGetEntity);
router.get('/stories/:storyId/threads', handleGetThreads);

// Assets (Phase 5)
router.get('/assets/:assetId/image', handleGetAssetImage);
router.get('/stories/:storyId/image', handleGetStoryImage);

// Series chapters (cross-volume spoiler selector)
router.get('/stories/:storyId/series-chapters', asyncHandler(async (req, res) => {
  const data = await getSeriesChapters(req.params.storyId as string);
  res.json(data);
}));

// Reading Progress (Phase 5)
router.get('/stories/:storyId/progress', handleGetProgress);
router.put('/stories/:storyId/progress', handleUpdateProgress);

// Users / profiles (M4)
router.get('/users', handleListUsers);
router.post('/users', handleCreateUser);
router.get('/users/:id', handleGetUser);
router.put('/users/:id', handleUpdateUser);
router.delete('/users/:id', handleDeleteUser);

// Series
router.get('/series', handleGetSeries);

// Jobs (M5) — async ingestion status. Reading a job by id is open (the admin UI polls it); the
// admin job list + cancel are gated.
router.get('/jobs/:jobId', handleGetJob);
router.get('/admin/jobs', adminAuth, handleListJobs);
router.post('/admin/jobs/:jobId/cancel', adminAuth, handleCancelJob);

// Admin — gated by ADMIN_TOKEN when configured (no-op in dev if unset)
router.get('/admin/stories', adminAuth, handleAdminGetStories);
router.delete('/admin/stories/:storyId', adminAuth, handleAdminDeleteStory);
router.post('/admin/ingest', adminAuth, ingestLimiter, upload.single('file'), handleAdminIngest);
router.get('/admin/traces/:traceId', adminAuth, handleGetTrace);
router.get('/admin/usage', adminAuth, handleGetUsage);

export default router;
