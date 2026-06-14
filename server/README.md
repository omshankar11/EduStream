# EduStream — Server

> **Express + Node.js backend** for the EduStream AI learning platform.  
> Handles YouTube transcript fetching, Gemini AI summarisation & quiz generation, Google OAuth, playlist management, and user progress tracking.

---

## 📋 Table of Contents

- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [API Reference](#-api-reference)
- [Transcript Engine](#-transcript-engine)
- [AI Engine](#-ai-engine)
- [Environment Variables](#️-environment-variables)
- [Running Locally](#-running-locally)
- [Docker](#-docker)
- [Deployment](#-deployment)

---

## 🛠 Tech Stack

| Layer        | Technology                                      |
| ------------ | ----------------------------------------------- |
| Runtime      | Node.js 18+                                     |
| Framework    | Express.js 5                                    |
| Database     | MongoDB (Mongoose 8)                            |
| Auth         | Passport.js · Google OAuth 2.0 · express-session|
| Session Store| connect-mongo (MongoDB-backed sessions)         |
| AI           | Google Gemini 2.5 Flash (`@google/generative-ai`)|
| Transcripts  | youtube-transcript-api (Python) + Invidious fallback |
| Dev Server   | nodemon                                         |

---

## 📁 Project Structure

```
server/
├── server.js                    # Entry point — Express app, middleware, route mounting
├── package.json
├── Dockerfile                   # Production Docker image (Node 18 + Python 3)
├── .dockerignore
├── env.example                  # Copy to .env and fill in your values
│
└── src/
    ├── config/
    │   ├── env.js               # Loads .env (must be imported FIRST in server.js)
    │   └── passport.js          # Google OAuth 2.0 strategy (Passport.js)
    │
    ├── middleware/
    │   ├── authMiddleware.js    # isAuthenticated — protects private routes
    │   └── rateLimit.js        # Sliding-window per-IP & per-user rate limiter
    │
    ├── models/
    │   ├── User.js              # Mongoose user schema (profile, progress, history)
    │   └── playlist.js          # Mongoose playlist schema
    │
    ├── routes/
    │   ├── auth.js              # Google OAuth login / logout / session
    │   ├── userRoutes.js        # Dashboard, profile, quiz results, tracking, history
    │   ├── playlist.js          # Playlist CRUD
    │   ├── feed.js              # Video feed & recommendations
    │   ├── aiRoutes.js          # POST /summarize, POST /quiz (Gemini)
    │   └── playerControl/
    │       └── transcript.js    # GET /:videoId/transcript, GET /:videoId/details
    │
    ├── services/
    │   └── transcriptService.js # Transcript engine (LRU cache, semaphore, dedup, fallback)
    │
    └── utils/
        ├── connectDB.js         # MongoDB connection helper
        ├── runPython.js         # Spawn Python subprocesses with timeout & UTF-8
        └── youtubeService.js    # YouTube Data API helpers (durations, playlists)
```

---

## 🔌 API Reference

Base URL (local): `http://localhost:5000`

### 🔐 Auth

| Method | Endpoint                 | Auth Required | Description                           |
| ------ | ------------------------ | :-----------: | ------------------------------------- |
| `GET`  | `/auth/google`           | ❌            | Redirect to Google OAuth consent page |
| `GET`  | `/auth/google/callback`  | ❌            | OAuth callback — sets session cookie  |
| `GET`  | `/auth/logout`           | ✅            | Destroy session & clear cookie        |
| `GET`  | `/auth/current-user`     | ❌            | Return current session user (or null) |

---

### 🎬 Videos & Transcripts

| Method | Endpoint                         | Auth Required | Description                          |
| ------ | -------------------------------- | :-----------: | ------------------------------------ |
| `GET`  | `/api/videos/:id/transcript`     | ✅            | Fetch transcript (rate-limited)      |
| `GET`  | `/api/videos/:id/details`        | ❌            | Video title, author, duration        |
| `GET`  | `/api/videos/stats`              | ❌            | Transcript service diagnostics       |

Query params for `/transcript`:
- `lang` — preferred language code (default `en`). Falls back to auto-detected languages if unavailable.

---

### 🤖 AI

| Method | Endpoint              | Auth Required | Body                      | Description                    |
| ------ | --------------------- | :-----------: | ------------------------- | ------------------------------ |
| `POST` | `/api/ai/summarize`   | ✅            | `{ transcript: string }`  | Generate markdown summary      |
| `POST` | `/api/ai/quiz`        | ✅            | `{ transcript: string }`  | Generate 5-question MCQ quiz   |

---

### 👤 User

| Method | Endpoint                   | Auth Required | Description                          |
| ------ | -------------------------- | :-----------: | ------------------------------------ |
| `GET`  | `/api/user/dashboard`      | ✅            | Stats, streaks, recent activity      |
| `PUT`  | `/api/user/profile`        | ✅            | Update display name / avatar         |
| `POST` | `/api/user/quiz-result`    | ✅            | Save quiz score                      |
| `POST` | `/api/user/track`          | ✅            | Mark a video as watched              |
| `GET`  | `/api/user/history`        | ✅            | Full learning history                |

---

### 📂 Playlists

| Method   | Endpoint               | Auth Required | Description                         |
| -------- | ---------------------- | :-----------: | ----------------------------------- |
| `POST`   | `/api/playlists`       | ✅            | Import a playlist from YouTube URL  |
| `GET`    | `/api/playlists`       | ✅            | List all of the user's playlists    |
| `DELETE` | `/api/playlists/:id`   | ✅            | Delete a playlist                   |

---

### 📡 Feed

| Method | Endpoint              | Auth Required | Description                          |
| ------ | --------------------- | :-----------: | ------------------------------------ |
| `GET`  | `/api/feed`           | ✅            | Personalised video recommendations   |

---

## 🧠 Transcript Engine

The engine is designed for reliability and speed with three layers of defense:

```
Incoming Request
│
├─ 1. LRU Cache hit? ──────────────────────────────► Return instantly (< 1 ms)
│
├─ 2. In-flight dedup — same video already fetching? ─► Await shared Promise
│
└─ 3. Concurrency semaphore (max 3 parallel workers)
       │
       ├─ Layer A: Python youtube-transcript-api (≥ 1.2.4)
       │    └─ 30 s timeout → SIGTERM then SIGKILL
       │
       └─ Layer B: Invidious public mirrors (9 instances)
```

**Rate limiting** — applied to `/api/videos/:id/transcript` only:

| Scope                  | Limit                         | Response on breach              |
| ---------------------- | ----------------------------- | ------------------------------- |
| Per IP                 | 10 requests / minute          | HTTP 429 + `Retry-After` header |
| Per authenticated user | 25 requests / 5 minutes       | HTTP 429 + `Retry-After` header |

---

## 🤖 AI Engine

All AI calls use **Gemini 2.5 Flash**:

```
Model: gemini-2.5-flash
```

- **Retry logic:** up to 2 attempts with a 1.5 s backoff on `503 / 429` errors.
- **Summary key:** `SUMMARY_API_KEY`
- **Quiz key:** `QUIZ_API_KEY`
- Both keys can point to the same Gemini API key.

---

## ⚙️ Environment Variables

Copy `env.example` to `.env` and fill in your values:

```bash
cp env.example .env
```

```env
# ── Server ──────────────────────────────────────────
PORT=5000
SERVER_URL=http://localhost:5000
CLIENT_URL=http://localhost:5173
NODE_ENV=development

# ── Database ─────────────────────────────────────────
MONGO_URI=mongodb://localhost:27017/edustream

# ── Google OAuth ──────────────────────────────────────
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SESSION_SECRET=a_long_random_secret_string

# ── AI (Google Gemini) ────────────────────────────────
SUMMARY_API_KEY=your_gemini_api_key
QUIZ_API_KEY=your_gemini_api_key

# ── YouTube Data API ──────────────────────────────────
YOUTUBE_API_KEY=your_youtube_data_api_key

# ── Transcript Engine (optional — safe defaults apply) ─
PYTHON_BIN=python          # python | python3 | py
TRANSCRIPT_LANGS=en,en-US,en-GB,en-IN,hi
```

> ⚠️ **Never commit `.env` to version control.** It is already listed in `.gitignore`.

---

## 🚀 Running Locally

### Prerequisites

- **Node.js** v18+
- **Python** 3.9+ (for transcript fetching)
- **MongoDB** instance (local or Atlas)
- Google Gemini API key
- Google OAuth credentials (Client ID & Secret)
- YouTube Data API key

### Steps

```bash
# 1. Install Node dependencies
npm install

# 2. Install Python transcript library (one-time)
pip install youtube-transcript-api
# or on some systems:
pip3 install youtube-transcript-api

# 3. Copy and configure environment
cp env.example .env
# → Edit .env with your actual keys

# 4. Start the dev server (auto-restarts on file change)
npm start
```

Server listens on **http://localhost:5000** (or `PORT` from `.env`).

### Available npm Scripts

| Command       | Description                              |
| ------------- | ---------------------------------------- |
| `npm start`   | Start dev server with nodemon            |
| `npm run prod`| Start production server (plain `node`)   |
| `npm run build`| Install Python dependencies (CI helper) |

---

## 🐳 Docker

A production-ready `Dockerfile` is included (Node 18 + Python 3):

```bash
# Build the image
docker build -t EduStream-server .

# Run the container (pass env vars via --env-file)
docker run -p 5000:5000 --env-file .env EduStream-server
```

Or use **Docker Compose** from the repo root:

```bash
docker-compose up --build
```

The compose file wires the server and MongoDB together automatically.

---

## ☁️ Deployment

### Render (recommended)

A `render.yaml` is included in the repo root for one-click deploys:

1. Push to GitHub.
2. Connect your repo on [render.com](https://render.com).
3. Set every key from `env.example` as a Render **Environment Variable**.
4. Render will run `npm run build` (installs Python deps) then `npm run prod`.

### Environment checklist for production

- `NODE_ENV=production`
- `CLIENT_URL` → your Netlify / Vercel frontend URL
- `SESSION_SECRET` → strong random string (use `openssl rand -hex 32`)
- Ensure your Google OAuth app has the production callback URL whitelisted:  
  `https://your-api-domain.com/auth/google/callback`

---

## 📝 License

MIT © EduStream Contributors

