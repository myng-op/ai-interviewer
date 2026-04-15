// ---------------------------------------------------------------------------
// Minimal Express backend — records interview transcripts to SQLite.
//
// Messages are saved incrementally as they arrive (like Django's
// curr_question.convo += ... ; curr_question.save()), so nothing is lost
// if the participant closes the tab mid-interview.
//
// Run:  npx tsx server/index.ts
// ---------------------------------------------------------------------------

import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'interviews.db');

import { mkdirSync } from 'fs';
mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS interviews (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    participant_id TEXT    NOT NULL,
    script_path   TEXT    NOT NULL DEFAULT '',
    total_time_sec INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at  TEXT
  );

  CREATE TABLE IF NOT EXISTS interview_messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    interview_id  INTEGER NOT NULL REFERENCES interviews(id),
    role          TEXT    NOT NULL CHECK(role IN ('interviewer', 'candidate')),
    text          TEXT    NOT NULL,
    timestamp     INTEGER NOT NULL,
    FOREIGN KEY (interview_id) REFERENCES interviews(id)
  );
`);

// Prepared statements
const stmtCreateInterview = db.prepare(`
  INSERT INTO interviews (participant_id, script_path, total_time_sec)
  VALUES (@participantId, @scriptPath, @totalTimeSec)
`);

const stmtInsertMessage = db.prepare(`
  INSERT INTO interview_messages (interview_id, role, text, timestamp)
  VALUES (@interviewId, @role, @text, @timestamp)
`);

const stmtCompleteInterview = db.prepare(`
  UPDATE interviews SET completed_at = datetime('now') WHERE id = ?
`);

const stmtListInterviews = db.prepare(`
  SELECT id, participant_id, script_path, total_time_sec, created_at, completed_at
  FROM interviews ORDER BY created_at DESC
`);

const stmtGetInterview = db.prepare(`
  SELECT id, participant_id, script_path, total_time_sec, created_at, completed_at
  FROM interviews WHERE id = ?
`);

const stmtGetMessages = db.prepare(`
  SELECT id, role, text, timestamp
  FROM interview_messages WHERE interview_id = ? ORDER BY timestamp ASC
`);

// ---------------------------------------------------------------------------
// 2. Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '10mb' }));

// POST /api/interviews — create a new interview session (called at start)
app.post('/api/interviews', (req, res) => {
  const { participantId, scriptPath, totalTimeSec } = req.body;

  if (!participantId) {
    res.status(400).json({ error: 'participantId is required' });
    return;
  }

  try {
    const result = stmtCreateInterview.run({
      participantId,
      scriptPath: scriptPath ?? '',
      totalTimeSec: totalTimeSec ?? 0,
    });
    const id = Number(result.lastInsertRowid);
    console.log(`[server] Created interview #${id} for "${participantId}"`);
    res.status(201).json({ id });
  } catch (err) {
    console.error('[server] Failed to create interview:', err);
    res.status(500).json({ error: 'Failed to create interview' });
  }
});

// POST /api/interviews/:id/messages — append one message (called per turn)
app.post('/api/interviews/:id/messages', (req, res) => {
  const interviewId = Number(req.params.id);
  const { role, text, timestamp } = req.body;

  if (!role || !text || timestamp == null) {
    res.status(400).json({ error: 'role, text, and timestamp are required' });
    return;
  }

  try {
    stmtInsertMessage.run({ interviewId, role, text, timestamp });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(`[server] Failed to save message for interview #${interviewId}:`, err);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

// PATCH /api/interviews/:id/complete — mark interview as done
app.patch('/api/interviews/:id/complete', (req, res) => {
  const interviewId = Number(req.params.id);
  try {
    stmtCompleteInterview.run(interviewId);
    console.log(`[server] Interview #${interviewId} marked complete`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[server] Failed to complete interview #${interviewId}:`, err);
    res.status(500).json({ error: 'Failed to complete interview' });
  }
});

// GET /api/interviews — list all interviews
app.get('/api/interviews', (_req, res) => {
  res.json(stmtListInterviews.all());
});

// GET /api/interviews/:id — get one interview with messages
app.get('/api/interviews/:id', (req, res) => {
  const interview = stmtGetInterview.get(Number(req.params.id));
  if (!interview) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const messages = stmtGetMessages.all(Number(req.params.id));
  res.json({ ...(interview as Record<string, unknown>), messages });
});

// ---------------------------------------------------------------------------
// 3. Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.API_PORT ?? '3001', 10);
app.listen(PORT, () => {
  console.log(`[server] API listening on http://localhost:${PORT}`);
  console.log(`[server] Database: ${DB_PATH}`);
});
