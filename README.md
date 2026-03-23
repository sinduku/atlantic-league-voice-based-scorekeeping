# Voice Scorekeeper ⚾

A real-time baseball scorekeeping app with voice-powered play logging. Built for the Atlantic League.

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend:** Node.js + Express (self-hosted)
- **AI:** Any OpenAI-compatible API (OpenAI, Ollama, Groq, Together, etc.)

## Quick Start

### 1. Start the backend

```bash
cd server
npm install
cp .env.example .env
```

Edit `server/.env` and add your API key:

```env
OPENAI_API_KEY=sk-your-key-here
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4o-mini
PORT=3001
```

Then start it:

```bash
npm start
```

### 2. Start the frontend

In a new terminal:

```bash
npm install
npm run dev
```

The app will be running at `http://localhost:5173` and will call the backend at `http://localhost:3001`.

## Using Ollama (Free, Fully Local)

If you don't want to pay for an API key, you can use [Ollama](https://ollama.ai) to run models locally:

1. Install Ollama from https://ollama.ai
2. Pull a model: `ollama pull llama3`
3. Set your `server/.env`:

```env
OPENAI_API_KEY=not-needed
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3
```

## Features

- 🎙️ Voice-to-play transcription via browser microphone
- 🤖 AI-powered play parsing (batter, action, runners, RBIs)
- 📊 Live scoreboard with inning tracking
- 🎯 Spray chart visualization
- 📋 Play-by-play log with confirmation flow

## Configuration

| Env Variable | Where | Description |
|---|---|---|
| `OPENAI_API_KEY` | `server/.env` | Your AI provider API key |
| `AI_BASE_URL` | `server/.env` | API endpoint URL |
| `AI_MODEL` | `server/.env` | Model name |
| `PORT` | `server/.env` | Backend port (default: 3001) |
| `VITE_API_URL` | Frontend `.env` | Backend URL (default: `http://localhost:3001`) |
