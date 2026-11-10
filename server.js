require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('node:crypto');
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OPEN_LIBRARY_TIMEOUT_MS = Number(process.env.OPEN_LIBRARY_TIMEOUT_MS) || 10000;
const STATE_KEY = 'next-chapter-state-v1';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be configured in the environment.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb', strict: true }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireJsonObject(value, label = 'Request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a JSON object.`);
  }
  return value;
}

function normalizeId(value) {
  const id = String(value ?? '').trim();
  if (!id || id.length > 160) throw new HttpError(400, 'A valid id is required.');
  return id;
}

function validateBook(book) {
  requireJsonObject(book, 'Book');
  if (typeof book.title !== 'string' || !book.title.trim() || book.title.length > 500) {
    throw new HttpError(400, 'Book title is required and must be at most 500 characters.');
  }
  if (book.author !== undefined && (typeof book.author !== 'string' || book.author.length > 500)) {
    throw new HttpError(400, 'Book author must be a string of at most 500 characters.');
  }
  if (book.status !== undefined && !['tbr', 'reading', 'completed'].includes(book.status)) {
    throw new HttpError(400, 'Book status must be tbr, reading, or completed.');
  }
  if (book.progress !== undefined && (!Number.isFinite(Number(book.progress)) || Number(book.progress) < 0 || Number(book.progress) > 100)) {
    throw new HttpError(400, 'Book progress must be between 0 and 100.');
  }
  if (book.rating !== undefined && book.rating !== null && (!Number.isInteger(Number(book.rating)) || Number(book.rating) < 1 || Number(book.rating) > 5)) {
    throw new HttpError(400, 'Book rating must be an integer from 1 to 5.');
  }
  return book;
}

function validateGoal(goal) {
  requireJsonObject(goal, 'Goal');
  if (typeof goal.name !== 'string' || !goal.name.trim() || goal.name.length > 200) {
    throw new HttpError(400, 'Goal name is required and must be at most 200 characters.');
  }
  if (!Number.isFinite(Number(goal.target)) || Number(goal.target) < 1 || Number(goal.target) > 1000000) {
    throw new HttpError(400, 'Goal target must be a positive number no greater than 1,000,000.');
  }
  if (goal.unit !== undefined && !['books', 'pages', 'genre'].includes(goal.unit)) {
    throw new HttpError(400, 'Goal unit must be books, pages, or genre.');
  }
  return goal;
}

// Auth stays in Supabase Auth on the client; every data route verifies that session.
const requireUser = asyncRoute(async (req, res, next) => {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match) throw new HttpError(401, 'Sign in to access your reading data.');
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data?.user) throw new HttpError(401, 'Your session is invalid or expired. Sign in again.');
  req.user = data.user;
  req.userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  next();
});

async function readState(userClient, userId) {
  const { data, error } = await userClient.from('user_data')
    .select('data').eq('user_id', userId).maybeSingle();
  if (error) throw new HttpError(502, 'Could not load saved reading data.');
  const state = data?.data;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return { books: [], goals: [] };
  return { ...state, books: Array.isArray(state.books) ? state.books : [], goals: Array.isArray(state.goals) ? state.goals : [] };
}

async function writeState(userClient, user, state) {
  const { error } = await userClient.from('user_data').upsert({
    user_id: user.id,
    name: String(user.user_metadata?.name || user.user_metadata?.full_name || ''),
    data: state,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw new HttpError(502, 'Could not save reading data. Check the user_data table and its row-level security policies.');
  return state;
}

async function mutateState(req, mutator) {
  const state = await readState(req.userSupabase, req.user.id);
  await mutator(state);
  return writeState(req.userSupabase, req.user, state);
}

async function openLibraryJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPEN_LIBRARY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'TheMidnightSpine/1.0 (reading tracker)' },
    });
    if (!response.ok) {
      if (response.status === 404) throw new HttpError(404, 'That Open Library record was not found.');
      if (response.status === 429) throw new HttpError(503, 'Open Library is rate limiting requests. Try again shortly.');
      throw new HttpError(502, `Open Library returned ${response.status}.`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new HttpError(504, 'Open Library took too long to respond.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// This is intentionally the public Supabase anon key. Never put a service-role key here.
app.get('/api/config.js', (req, res) => {
  res.type('application/javascript').send(
    `window.__SUPABASE_CONFIG__=${JSON.stringify({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY })};`,
  );
});

// Catalog routes proxy Open Library and keep its response format compatible with the UI.
app.get('/api/books/search', asyncRoute(async (req, res) => {
  const title = String(req.query.title || '').trim();
  if (!title || title.length > 200) throw new HttpError(400, 'Search title is required and must be at most 200 characters.');
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 100);
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('title', title);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,publisher,cover_i,number_of_pages_median');
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await openLibraryJson(url));
}));

app.get('/api/books/works/:workId', asyncRoute(async (req, res) => {
  const workId = String(req.params.workId || '').replace(/\.json$/i, '');
  if (!/^OL\d+W$/.test(workId)) throw new HttpError(400, 'A valid Open Library work id is required.');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await openLibraryJson(`https://openlibrary.org/works/${encodeURIComponent(workId)}.json`));
}));

app.get('/api/state', requireUser, asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ state: await readState(req.userSupabase, req.user.id) });
}));

app.put('/api/state', requireUser, asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const state = requireJsonObject(req.body?.state, 'state');
  if (state.books !== undefined && !Array.isArray(state.books)) throw new HttpError(400, 'state.books must be an array.');
  if (state.goals !== undefined && !Array.isArray(state.goals)) throw new HttpError(400, 'state.goals must be an array.');
  res.json({ state: await writeState(req.userSupabase, req.user, state) });
}));

app.get('/api/books', requireUser, asyncRoute(async (req, res) => {
  const state = await readState(req.userSupabase, req.user.id);
  const books = state.books;
  const status = req.query.status;
  res.json({ books: status ? books.filter((book) => book.status === status) : books });
}));

app.post('/api/books', requireUser, asyncRoute(async (req, res) => {
  const book = validateBook(req.body);
  const id = normalizeId(book.id || randomUUID());
  const saved = await mutateState(req, (state) => {
    state.books ||= [];
    if (state.books.some((item) => item.id === id)) throw new HttpError(409, 'That book is already in your reading list.');
    state.books.push({ ...book, id, title: book.title.trim() });
  });
  res.status(201).json({ book: saved.books.find((item) => item.id === id) });
}));

app.patch('/api/books/:id', requireUser, asyncRoute(async (req, res) => {
  const id = normalizeId(req.params.id);
  const patch = requireJsonObject(req.body);
  const saved = await mutateState(req, (state) => {
    const index = state.books.findIndex((book) => book.id === id);
    if (index < 0) throw new HttpError(404, 'Book not found.');
    const next = { ...state.books[index], ...patch, id };
    validateBook(next);
    state.books[index] = next;
  });
  res.json({ book: saved.books.find((item) => item.id === id) });
}));

app.delete('/api/books/:id', requireUser, asyncRoute(async (req, res) => {
  const id = normalizeId(req.params.id);
  const saved = await mutateState(req, (state) => {
    const length = state.books.length;
    state.books = state.books.filter((book) => book.id !== id);
    if (state.books.length === length) throw new HttpError(404, 'Book not found.');
  });
  res.json({ books: saved.books });
}));

app.put('/api/books/:id/progress', requireUser, asyncRoute(async (req, res) => {
  const progress = Number(req.body?.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new HttpError(400, 'Progress must be between 0 and 100.');
  const id = normalizeId(req.params.id);
  const saved = await mutateState(req, (state) => {
    const book = state.books.find((item) => item.id === id);
    if (!book) throw new HttpError(404, 'Book not found.');
    book.progress = progress;
    book.status = progress >= 100 ? 'completed' : 'reading';
    if (progress >= 100) book.completedAt ||= new Date().toISOString().slice(0, 10);
  });
  res.json({ book: saved.books.find((item) => item.id === id) });
}));

app.put('/api/books/:id/review', requireUser, asyncRoute(async (req, res) => {
  const { rating, note } = requireJsonObject(req.body);
  if (rating !== undefined && rating !== null && (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
    throw new HttpError(400, 'Rating must be from 1 to 5.');
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > 5000)) throw new HttpError(400, 'Review note must be at most 5,000 characters.');
  const id = normalizeId(req.params.id);
  const saved = await mutateState(req, (state) => {
    const book = state.books.find((item) => item.id === id);
    if (!book) throw new HttpError(404, 'Book not found.');
    if (rating !== undefined) book.rating = rating === null ? null : Number(rating);
    if (note !== undefined) book.note = note;
  });
  res.json({ book: saved.books.find((item) => item.id === id) });
}));

app.get('/api/reading-log', requireUser, asyncRoute(async (req, res) => {
  const state = await readState(req.userSupabase, req.user.id);
  res.json({ books: state.books.filter((book) => book.status === 'completed').sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || ''))) });
}));

app.get('/api/goals', requireUser, asyncRoute(async (req, res) => {
  const state = await readState(req.userSupabase, req.user.id);
  res.json({ goals: state.goals });
}));

app.post('/api/goals', requireUser, asyncRoute(async (req, res) => {
  const goal = validateGoal(req.body);
  const id = normalizeId(goal.id || randomUUID());
  const saved = await mutateState(req, (state) => {
    state.goals ||= [];
    if (state.goals.some((item) => item.id === id)) throw new HttpError(409, 'That goal already exists.');
    state.goals.push({ ...goal, id, target: Number(goal.target), name: goal.name.trim() });
  });
  res.status(201).json({ goal: saved.goals.find((item) => item.id === id) });
}));

app.patch('/api/goals/:id', requireUser, asyncRoute(async (req, res) => {
  const id = normalizeId(req.params.id);
  const patch = requireJsonObject(req.body);
  const saved = await mutateState(req, (state) => {
    const index = state.goals.findIndex((goal) => goal.id === id);
    if (index < 0) throw new HttpError(404, 'Goal not found.');
    const next = { ...state.goals[index], ...patch, id };
    validateGoal(next);
    state.goals[index] = { ...next, target: Number(next.target) };
  });
  res.json({ goal: saved.goals.find((item) => item.id === id) });
}));

app.delete('/api/goals/:id', requireUser, asyncRoute(async (req, res) => {
  const id = normalizeId(req.params.id);
  const saved = await mutateState(req, (state) => {
    const length = state.goals.length;
    state.goals = state.goals.filter((goal) => goal.id !== id);
    if (state.goals.length === length) throw new HttpError(404, 'Goal not found.');
  });
  res.json({ goals: saved.goals });
}));

app.use(express.static(__dirname));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next(new HttpError(404, 'API endpoint not found.'));
  next();
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : error.type === 'entity.parse.failed' ? 400 : 500;
  if (status >= 500) console.error('Request failed:', error);
  res.status(status).json({ error: status >= 500 && status === 500 ? 'An unexpected server error occurred.' : error.message });
});

app.listen(PORT, () => {
  console.log(`The Midnight Spine is running at http://localhost:${PORT}`);
});
