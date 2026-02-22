require('dotenv').config({ path: require('os').homedir() + '/.env' });

const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname)));

// Rate limit API endpoints: max 30 requests per IP per 10 minutes
const apiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});
app.use('/api/', apiLimiter);

const PORT = 3456;

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// -------------------------------------------------------------------
// Load lens definitions from ~/lenses/ on startup
// -------------------------------------------------------------------
const LENSES_DIR = fs.existsSync(path.join(__dirname, 'lenses'))
  ? path.join(__dirname, 'lenses')
  : path.join(require('os').homedir(), 'lenses');
const LENS_FILES = {
  lamesh:     'lamesh.md',
  computing:  'computing.md',
  statistics: 'statistics.md',
};
const lensContent = {};
for (const [key, file] of Object.entries(LENS_FILES)) {
  const p = path.join(LENSES_DIR, file);
  if (fs.existsSync(p)) {
    lensContent[key] = fs.readFileSync(p, 'utf8').trim();
    console.log(`Lens loaded: ${key}`);
  }
}

// Return lens content relevant to any keywords found in the context string
function resolveLensContext(context) {
  if (!context) return '';
  const lower = context.toLowerCase();
  const matched = [];
  if (/\bla\s*mesh\b/.test(lower))                matched.push(lensContent.lamesh);
  if (/\bsteam?\b/.test(lower) && lensContent.lamesh) matched.push(lensContent.lamesh);
  if (/\bcomputing\b|computer science/.test(lower)) matched.push(lensContent.computing);
  if (/\bstatistics?\b|statistical/.test(lower))   matched.push(lensContent.statistics);
  return matched.filter(Boolean).join('\n\n---\n\n');
}

const MODELS = {
  gemini:      'google/gemini-3.1-pro-preview',
  openai:      'openai/gpt-5.2',
  anthropic:   'anthropic/claude-opus-4-6',
  coordinator: 'anthropic/claude-opus-4-6',
  imageGen:    'google/gemini-3-pro-image-preview',  // Nano Banana Pro — image generation
};

// -------------------------------------------------------------------
// GET /config — tell frontend which keys are available
// -------------------------------------------------------------------
app.get('/config', (req, res) => {
  res.json({ hasOpenRouter: !!OPENROUTER_API_KEY });
});

// -------------------------------------------------------------------
// POST /api/query — routes question to appropriate pipeline
// Body: { image: <base64 dataURL>, question: string, params: { state, level, detail } }
// -------------------------------------------------------------------
app.post('/api/query', async (req, res) => {
  const { image, question, params, apiKey, history } = req.body;
  const key = OPENROUTER_API_KEY || apiKey;

  if (!key) return res.status(401).json({ error: 'No OpenRouter API key available.' });
  if (!question || !image) return res.status(400).json({ error: 'image and question are required.' });

  try {
    const workerResults = await callWorkers(key, image, question, params, history);
    const answer = await callCoordinator(key, image, question, params, workerResults, history);
    if (answer.type === 'image-generation') {
      const result = await handleImageGeneration(key, image, answer.imagePrompt || question);
      res.json(result);
    } else {
      res.json(answer);
    }
  } catch (err) {
    console.error('Pipeline error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------------
// Image generation handler — coordinator sends question to Gemini image model
// -------------------------------------------------------------------
async function handleImageGeneration(key, inputImage, question) {
  const imageContent = buildImageContent(inputImage);
  const messages = [
    {
      role: 'user',
      content: [
        imageContent,
        { type: 'text', text: question },
      ],
    },
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3456',
      'X-Title': 'Curious Jack',
    },
    body: JSON.stringify({ model: MODELS.imageGen, messages }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Image generation: ${response.status} ${errText}`);
  }

  const data = await response.json();
  console.log('Image gen raw response:', JSON.stringify(data, null, 2).slice(0, 2000));

  // Extract generated image from response
  let generatedImageUrl = null;
  let captionText = '';
  const msg = data.choices?.[0]?.message;

  // Gemini via OpenRouter returns images in message.images[]
  if (msg?.images?.[0]?.image_url?.url) {
    generatedImageUrl = msg.images[0].image_url.url;
  }
  // Fallback: some models embed image_url parts in content array
  if (!generatedImageUrl && Array.isArray(msg?.content)) {
    for (const part of msg.content) {
      if (part.type === 'image_url') generatedImageUrl = part.image_url?.url;
      if (part.type === 'text') captionText = part.text;
    }
  }
  if (typeof msg?.content === 'string') captionText = msg.content;

  return {
    type: 'image-generation',
    question,
    generatedImage: generatedImageUrl,
    answer: captionText || 'Image generated by Gemini 3.1 Pro.',
    subjects: ['Visual Arts', 'Generative AI'],
    standards: [],
  };
}

// -------------------------------------------------------------------
// Call all 3 workers in parallel via OpenRouter
// -------------------------------------------------------------------
async function callWorkers(key, image, question, params, history) {
  const workerPrompt = buildWorkerPrompt(question, params, history);
  const imageContent = buildImageContent(image);
  const thinking = !!params.thinking;

  const calls = Object.entries({
    gemini:    MODELS.gemini,
    openai:    MODELS.openai,
    anthropic: MODELS.anthropic,
  }).map(([name, model]) =>
    callOpenRouter(key, model, workerPrompt, imageContent, thinking)
      .then(text => ({ name, text }))
      .catch(err => ({ name, text: `[${name} error: ${err.message}]` }))
  );

  return Promise.all(calls);
}

// -------------------------------------------------------------------
// Call coordinator with worker results
// -------------------------------------------------------------------
async function callCoordinator(key, image, question, params, workerResults, history) {
  const prompt = buildCoordinatorPrompt(question, params, workerResults, history);
  const imageContent = buildImageContent(image);
  const raw = await callOpenRouter(key, MODELS.coordinator, prompt, imageContent, !!params.thinking);
  return parseCoordinatorResponse(raw, question);
}

// -------------------------------------------------------------------
// OpenRouter API call (vision-capable: image + text)
// thinking=true enables extended reasoning per model:
//   Claude  — thinking:{type:"enabled", budget_tokens:10000} + temperature:1
//   Gemini  — model variant :thinking
//   GPT     — reasoning_effort:"high"
// -------------------------------------------------------------------
async function callOpenRouter(key, model, textPrompt, imageContent, thinking = false) {
  const messages = [
    {
      role: 'user',
      content: [
        imageContent,
        { type: 'text', text: textPrompt },
      ],
    },
  ];

  const body = { model, messages };

  if (thinking) {
    if (model.startsWith('anthropic/')) {
      body.thinking = { type: 'enabled', budget_tokens: 10000 };
      body.temperature = 1; // required by Anthropic when thinking is enabled
    } else if (model.startsWith('google/')) {
      body.model = model.replace(/:thinking$/, '') + ':thinking';
    } else if (model.startsWith('openai/')) {
      body.reasoning_effort = 'high';
    }
  } else {
    body.temperature = 0.7;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3456',
      'X-Title': 'Curious Jack',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter [${model}]: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`No content returned from ${model}`);
  return content;
}

// -------------------------------------------------------------------
// Build image content block from base64 dataURL
// -------------------------------------------------------------------
function buildImageContent(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data URL');
  return {
    type: 'image_url',
    image_url: { url: dataUrl },
  };
}

// -------------------------------------------------------------------
// Worker prompt
// -------------------------------------------------------------------
function buildWorkerPrompt(question, params, history) {
  const { state = 'Florida', level = 'high', detail = 'medium', location = '', context = '' } = params || {};
  const detailGuide = {
    low:    'one primary subject, concise answer',
    medium: 'two or three subjects, moderate depth',
    high:   'four or more subjects, comprehensive depth across disciplines',
  }[detail] || 'moderate depth';

  const lensBlock = resolveLensContext(context);
  const contextSection = context
    ? `\nContext (guides your answer):\n${context}${lensBlock ? `\n\nLens reference material:\n${lensBlock}` : ''}\n`
    : '';

  const historySection = (history && history.length > 0)
    ? '\nPrior conversation:\n' + history.map((h, i) => `Q${i + 1}: ${h.question}\nA: ${h.answer}`).join('\n') + '\n'
    : '';

  return `You are an educational expert analyzing the image above to answer a student question.

Parameters:
- State: ${state}
- Level: ${level} school
- Detail: ${detail} (${detailGuide})${location ? `\n- Location/Source: ${location}` : ''}${contextSection}${historySection}
Question: ${question}

Respond with:
1. subjects: a comma-separated list of relevant academic disciplines (e.g. Physics, Art, Meteorology)
2. answer: a clear, level-appropriate explanation. More detail means more subjects covered and more depth per subject.

Format your response exactly as:
SUBJECTS: [comma-separated list]
ANSWER: [your answer]`;
}

// -------------------------------------------------------------------
// Build state-appropriate standards instruction
// -------------------------------------------------------------------
function buildStandardsInstruction(state) {
  if (state === 'Florida') {
    return `Add a Florida educational standards alignment section in PBS Learning Media style.
   Include 1–3 CPALMS standards DIRECTLY relevant to the question — not just tangentially related subjects.
   - For questions about artworks or visual culture, ALWAYS include Visual Arts (VA.) standards first.
   - Match the grade band to the level parameter.
   - Use real CPALMS standard codes (e.g. VA.912.C.1.2, VA.912.H.1.2, SC.912.P.10.1).
   - Do NOT include standards for subjects only peripheral to the question.`;
  } else if (state === 'National') {
    return `Add a national US educational standards alignment section in PBS Learning Media style.
   Include 1–3 standards DIRECTLY relevant to the question from appropriate national bodies:
   - ELA / Math: Common Core State Standards (corestandards.org)
   - Science: Next Generation Science Standards (nextgenscience.org)
   - Arts: National Core Arts Standards (nationalartsstandards.org)
   - Social Studies: C3 Framework (socialstudies.org/c3)
   - Use real standard codes where they exist. Match grade band to level.`;
  } else {
    return `Add a ${state} state educational standards alignment section in PBS Learning Media style.
   Include 1–3 ${state} state standards DIRECTLY relevant to the question.
   - Use the official ${state} state standards and their standard codes.
   - Match the grade band to the level parameter.
   - Provide the official ${state} state standards website URL where possible.
   - Do NOT include standards for subjects only peripheral to the question.`;
  }
}

// -------------------------------------------------------------------
// Coordinator synthesis prompt
// -------------------------------------------------------------------
function buildCoordinatorPrompt(question, params, workerResults, history) {
  const { state = 'Florida', level = 'high', detail = 'medium', location = '', context = '' } = params || {};
  const workerSection = workerResults
    .map(w => `=== ${w.name.toUpperCase()} ===\n${w.text}`)
    .join('\n\n');

  const lensBlock = resolveLensContext(context);
  const contextSection = context
    ? `\nContext (must guide your final answer):\n${context}${lensBlock ? `\n\nLens reference material:\n${lensBlock}` : ''}`
    : '';

  const historySection = (history && history.length > 0)
    ? '\nPrior conversation:\n' + history.map((h, i) => `Q${i + 1}: ${h.question}\nA: ${h.answer}`).join('\n')
    : '';

  return `You are a coordinator synthesizing educational answers from three AI workers.

Original question: ${question}
Level: ${level} school
Detail: ${detail}
State: ${state}${location ? `\nLocation/Source: ${location}` : ''}${contextSection}${historySection}

Worker responses:
${workerSection}

Your tasks:
0. First, decide if the question is asking to CREATE or GENERATE any kind of image — artwork, sketches, paintings, diagrams, charts, plots, maps, illustrations, or any visual output. If so, set "type" to "image-generation" and "imagePrompt" to a clear, detailed prompt for an image generation model, then you may leave answer/subjects/standards empty. Otherwise set "type" to "text" and proceed with tasks 1–5.
1. Identify facts or claims where 2 or 3 workers agree — treat these as confirmed and state them confidently.
2. Identify facts or claims where workers disagree — where one worker contradicts another, note the uncertainty or present the most likely interpretation, briefly explaining why.
3. Incorporate unique insights from individual workers only if they are plausible and add value.
4. Produce a final list of subjects (academic disciplines) covered.
5. Write a single comprehensive, level-appropriate answer that reflects the above — majority-agreed facts stated confidently, genuine disagreements acknowledged concisely.
6. ${buildStandardsInstruction(state)}

Return ONLY valid JSON in this exact structure (no markdown fences):
{
  "type": "text",
  "question": "${question.replace(/"/g, '\\"')}",
  "subjects": ["Subject1", "Subject2"],
  "answer": "Full synthesized answer here.",
  "standards": [
    {
      "subject": "Science",
      "gradeBand": "9-12",
      "code": "SC.912.P.10.1",
      "description": "Standard description here.",
      "url": "https://www.cpalms.org/Public/PreviewStandard/Preview/..."
    }
  ]
}

For image-generation questions, use this structure instead:
{
  "type": "image-generation",
  "question": "${question.replace(/"/g, '\\"')}",
  "imagePrompt": "Detailed prompt for the image model here.",
  "subjects": [],
  "answer": "",
  "standards": []
}`;
}

// -------------------------------------------------------------------
// Parse coordinator JSON response (tolerant of minor wrapping)
// -------------------------------------------------------------------
function parseCoordinatorResponse(raw, question) {
  // Strip any accidental markdown code fences
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: return raw text as answer if JSON parse fails
    return {
      question,
      subjects: [],
      answer: raw,
      standards: [],
    };
  }
}

// -------------------------------------------------------------------
// POST /api/describe-image — returns a short 2-5 word label for the image
// Body: { image (base64 dataURL), apiKey? }
// -------------------------------------------------------------------
app.post('/api/describe-image', async (req, res) => {
  const { image, apiKey } = req.body;
  const key = OPENROUTER_API_KEY || apiKey;
  if (!key || !image) return res.status(400).json({ label: 'untitled' });

  try {
    const imageContent = buildImageContent(image);
    const prompt = 'Describe this image in 2 to 5 words suitable as a short folder name. Use only letters, numbers, and hyphens. No punctuation. Examples: "cotan-still-life-1602", "golden-gate-bridge", "classroom-whiteboard". Reply with ONLY the label, nothing else.';
    const raw = await callOpenRouter(key, MODELS.coordinator, prompt, imageContent);
    const label = raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    res.json({ label: label || 'untitled' });
  } catch {
    res.json({ label: 'untitled' });
  }
});

// -------------------------------------------------------------------
// POST /api/save-session
// Body: { imageName, image (base64 dataURL), params, questions (array of result objects) }
// Saves to images/<imageName>/session.json and images/<imageName>/image.<ext>
// -------------------------------------------------------------------
app.post('/api/save-session', (req, res) => {
  const { imageName, image, params, questions } = req.body;
  if (!imageName || !questions) {
    return res.status(400).json({ error: 'imageName and questions are required.' });
  }

  // Derive a safe folder name from the image filename (strip extension, sanitize)
  const base = path.basename(imageName, path.extname(imageName))
    .replace(/[^a-zA-Z0-9_\-. ]/g, '_')
    .trim() || 'session';

  const sessionDir = path.join(__dirname, 'images', base);
  fs.mkdirSync(sessionDir, { recursive: true });

  // Save session JSON
  const session = {
    imageName,
    timestamp: new Date().toISOString(),
    params,
    questions,
  };
  fs.writeFileSync(path.join(sessionDir, 'session.json'), JSON.stringify(session, null, 2));

  // Save image file
  if (image) {
    const match = image.match(/^data:(image\/([^;]+));base64,(.+)$/);
    if (match) {
      const ext = match[2] === 'jpeg' ? 'jpg' : match[2];
      const imgData = Buffer.from(match[3], 'base64');
      fs.writeFileSync(path.join(sessionDir, `image.${ext}`), imgData);
    }
  }

  console.log(`Session saved: images/${base}/`);
  res.json({ saved: true, folder: `images/${base}` });
});

// -------------------------------------------------------------------
// Markdown export: POST stores content, GET serves as named download
// -------------------------------------------------------------------
const exportTokens = new Map();

app.post('/api/export-markdown', (req, res) => {
  const { content, folder } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required.' });

  // Save report.md into the session folder if available
  if (folder) {
    const sessionDir = path.join(__dirname, folder);
    if (fs.existsSync(sessionDir)) {
      fs.writeFileSync(path.join(sessionDir, 'report.md'), content);
      console.log(`Markdown saved to ${folder}/report.md`);
    }
  }

  const token = require('crypto').randomUUID();
  exportTokens.set(token, content);
  setTimeout(() => exportTokens.delete(token), 60000); // clean up after 60s
  res.json({ token });
});

app.get('/api/export/:token/curiosity-report.md', (req, res) => {
  const content = exportTokens.get(req.params.token);
  if (!content) return res.status(404).send('Export expired or not found.');
  exportTokens.delete(req.params.token);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="curiosity-report.md"');
  res.send(content);
});

// -------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Curious Jack running at http://localhost:${PORT}`);
  console.log(`OpenRouter key: ${OPENROUTER_API_KEY ? 'loaded from ~/.env' : 'NOT FOUND'}`);
});
