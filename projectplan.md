# Curiosity App — Project Plan

## Overview
A web app that takes an image + a batch of questions, routes them through 3 worker LLMs in parallel, and has a coordinator LLM synthesize the answers. Outputs are organized by question, tagged with academic subjects, include Florida educational standards alignment (PBS-style), and can be exported as Markdown or PDF.

---

## Architecture

### Backend: Node.js Express server
- Reads `OPENROUTER_API_KEY` from `~/.env`
- Serves static frontend files
- Proxies all LLM API calls (keys never exposed to browser)
- Single `/api/query` endpoint handles the full multi-LLM pipeline

### Frontend: HTML + CSS + JS (static)
- Image upload: drag & drop or file picker
- Questions: textarea (type/paste) or `.txt`/`.md` file upload
- Parameters: State (default Florida), Level, Detail
- Results: per-question, subject-tagged, with standards alignment
- Export: Markdown or PDF

### LLM Pipeline (per-question, sequential)
- Frontend loops through questions **one at a time**
- For each question, frontend POSTs to `/api/query` with image + single question + parameters
- Server sends to **3 workers in parallel** (all via OpenRouter using `OPENROUTER_API_KEY`):
  - **Gemini**: `google/gemini-3.1-pro-preview`
  - **OpenAI**: `openai/gpt-5.2`
  - **Anthropic (worker)**: `anthropic/claude-opus-4-6`
- Server sends all 3 worker responses to **coordinator**:
  - **Coordinator**: `anthropic/claude-opus-4-6` via OpenRouter
- Coordinator synthesizes and returns structured JSON for that one question
- Frontend renders that question's answer card **immediately** before moving to next question
- User sees results populate progressively, question by question

### Florida Standards
- Coordinator generates PBS Learning Media-style standards blocks (CPALMS)
- References: subject area, grade band, standard code + description, CPALMS URL
- Based on coordinator LLM knowledge of Florida CPALMS standards

---

## Files to Create

```
curiosity/
├── projectplan.md        ← this file
├── Requirements.md       ← existing
├── package.json
├── server.js             ← Express server + LLM proxy
├── index.html            ← Main UI
├── style.css             ← Styling
├── app.js                ← Frontend logic
├── start                 ← Shell script to start server
└── stop                  ← Shell script to stop server
```

---

## Todo Items

### Phase 1 — Project Setup
- [ ] Create `package.json` with dependencies (express, dotenv, node-fetch, multer)
- [ ] Create `start` and `stop` shell scripts

### Phase 2 — Server
- [ ] Create `server.js` that loads `~/.env`
- [ ] Serve static files from project root
- [ ] `GET /config` — tell frontend which keys are available (Gemini, OpenRouter)
- [ ] `POST /api/query` — orchestrates the full pipeline:
  - Accepts image (base64) + questions + parameters
  - Calls 3 workers in parallel
  - Calls coordinator with worker results
  - Returns structured JSON

### Phase 3 — Frontend Layout (`index.html` + `style.css`)
- [ ] Header with app title and parameters panel (State, Level, Detail)
- [ ] Image upload section (drag & drop + file picker, preview)
- [ ] Questions input section (textarea + file upload button)
- [ ] Submit button with loading indicator
- [ ] Results section (scrollable, per-question cards)
- [ ] Export buttons (Markdown, PDF)
- [ ] API key popup modal (shown if keys not available)

### Phase 4 — Frontend Logic (`app.js`)
- [ ] Load `/config` on startup; show API key popup if needed
- [ ] Handle image drag & drop and file selection → base64
- [ ] Handle questions file upload (`.txt` / `.md`)
- [ ] Submit handler: POST to `/api/query`, show spinner
- [ ] Render results: per question → subjects → answer → standards block
- [ ] Markdown export: build `.md` string from results, trigger download
- [ ] PDF export: use `window.print()` with print-specific CSS

### Phase 5 — Testing
- [ ] Test with a sample image and sample questions
- [ ] Verify all 3 workers are called and coordinator synthesizes
- [ ] Verify Florida standards alignment appears
- [ ] Verify Markdown and PDF export work

---

## LLM Prompts (design)

### Worker Prompt
```
You are an educational expert analyzing an image to answer student questions.

Level: [elementary | middle | high | advanced]
Detail: [low | medium | high]
State: Florida

For each question below, provide:
- subjects: list of relevant academic disciplines
- answer: appropriate to the level; low detail = 1 subject, high detail = multiple subjects and deeper coverage

Questions:
[numbered list]
```

### Coordinator Synthesis Prompt
```
You are a coordinator synthesizing educational answers from 3 AI workers.

Original questions, level, and detail level are provided.
For each question:
1. Merge overlapping content from workers; aggregate unique insights
2. List all subjects covered (e.g., Physics, Art, Meteorology)
3. Write a comprehensive, level-appropriate answer
4. Add a Florida CPALMS standards alignment block (PBS Learning Media style):
   - Subject area, Grade band, Standard code, Standard description, CPALMS URL

Return structured JSON:
{
  "questions": [
    {
      "question": "...",
      "subjects": ["Physics", "Art"],
      "answer": "...",
      "standards": [
        {
          "subject": "Science",
          "gradeBand": "9-12",
          "code": "SC.912.P.10.1",
          "description": "...",
          "url": "https://www.cpalms.org/..."
        }
      ]
    }
  ]
}
```

---

## Review

### What was built
- `server.js` — Node.js/Express server that loads `OPENROUTER_API_KEY` from `~/.env`, serves static files, and exposes two endpoints: `GET /config` (key availability) and `POST /api/query` (full pipeline for one question)
- `index.html` — Clean single-page UI with image upload, questions input, parameters bar, progressive results, and export buttons
- `style.css` — Claude.ai-inspired warm cream/terracotta aesthetic (dark charcoal header, `#c96442` terracotta primary, warm cream background)
- `app.js` — Frontend logic: sequential per-question processing, skeleton loading cards, progressive rendering, Markdown download, PDF via `window.print()`
- `package.json`, `start`, `stop` — project setup and server lifecycle scripts

### Key design decisions
- All 3 workers (Gemini 3.1 Pro Preview, GPT-5.2, Claude Opus 4.6) called in parallel per question via OpenRouter
- Coordinator (Claude Opus 4.6) synthesizes worker results into JSON with subjects, answer, and CPALMS standards
- Questions processed one at a time so results appear progressively — no long wait for all answers
- Florida CPALMS standards alignment generated by coordinator LLM with standard codes and URLs

### Test result
Tested with Sánchez Cotán's 1602 still life painting and two questions:
- Both questions answered correctly with subject tags, comprehensive answers, and accurate Florida CPALMS standard references
- Progressive rendering worked: Q1 appeared before Q2 started processing
- Export Markdown and Export PDF buttons functional

### March 2026 Update — TTS + Export Fixes

**Added:**
- **Text-to-Speech**: `/api/tts` endpoint using `openai/gpt-4o-mini-audio-preview` via OpenRouter. Speaker button on each answer card. Voice selector (alloy/echo/fable/onyx/nova/shimmer) in params bar.

**Fixed:**
- **Markdown export**: Now embeds the uploaded image as a base64 `![Image](data:...)` instead of just the filename text.
- **PDF export**: Now wraps `#printImageHeader` (banner, title, byline, params, image) + `#resultsBody` in a temporary container for html2pdf capture, so the PDF includes the image header instead of being blank.
