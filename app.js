/* ---- Curiosity — frontend logic ---- */

let imageDataUrl = null;
let imageName = null;
let apiKey = null;
let bannerDataUrl = null;
let questionCounter = 0;
let conversationHistory = [];

// -----------------------------------------------------------------------
// Init
// -----------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const cfg = await fetch('/config').then(r => r.json()).catch(() => ({}));
  if (!cfg.hasOpenRouter) {
    apiKey = localStorage.getItem('openrouter_key') || '';
    if (!apiKey) showKeyModal();
  }

  // Pre-load banner as base64 for markdown embedding
  fetch('banner/curiousjack.jpg')
    .then(r => r.blob())
    .then(blob => {
      const reader = new FileReader();
      reader.onload = e => { bannerDataUrl = e.target.result; };
      reader.readAsDataURL(blob);
    })
    .catch(() => {});

  setupImageUpload();
  setupQuestionsUpload();
  setupSubmit();
  setupExport();
});

// -----------------------------------------------------------------------
// API key modal
// -----------------------------------------------------------------------
function showKeyModal() {
  document.getElementById('keyModal').classList.remove('hidden');
}

document.getElementById('saveKeyBtn').addEventListener('click', () => {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) return;
  apiKey = val;
  localStorage.setItem('openrouter_key', val);
  document.getElementById('keyModal').classList.add('hidden');
});

// -----------------------------------------------------------------------
// Image upload — drag & drop + file picker
// -----------------------------------------------------------------------
function setupImageUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('imageFile');
  const preview   = document.getElementById('imagePreview');

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    imageName = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      imageDataUrl = e.target.result;
      questionCounter = 0;
      conversationHistory = [];
      preview.src = imageDataUrl;
      preview.classList.remove('hidden');
      dropZone.classList.add('hidden');
      document.getElementById('printImage').src = imageDataUrl;
      // Clear previous results when a new image is loaded
      const resultsBody = document.getElementById('resultsBody');
      if (resultsBody) resultsBody.innerHTML = '';
      const results = document.getElementById('results');
      if (results) results.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  // Lightbox — click preview to enlarge, click lightbox or ESC to close
  const lightbox    = document.getElementById('imageLightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const zoomLens    = document.getElementById('zoomLens');
  const LENS_SIZE   = 220;
  let zoomLevel     = 2;   // multiplier on original image pixels

  preview.addEventListener('click', () => {
    lightboxImg.src = imageDataUrl;
    lightbox.classList.remove('hidden');
  });
  lightbox.addEventListener('click', () => {
    lightbox.classList.add('hidden');
    zoomLens.classList.add('hidden');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      lightbox.classList.add('hidden');
      zoomLens.classList.add('hidden');
    }
  });

  // Zoom lens — show on mousemove over the lightbox image
  lightboxImg.addEventListener('mouseenter', () => {
    zoomLens.style.backgroundImage = `url(${imageDataUrl})`;
    zoomLens.classList.remove('hidden');
    lightboxImg.style.cursor = 'none';
  });
  lightboxImg.addEventListener('mouseleave', () => {
    zoomLens.classList.add('hidden');
    lightboxImg.style.cursor = '';
  });
  lightboxImg.addEventListener('mousemove', e => {
    const rect = lightboxImg.getBoundingClientRect();
    // Mouse position within the displayed image
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Map displayed coords → original image coords
    const natW = lightboxImg.naturalWidth;
    const natH = lightboxImg.naturalHeight;
    const mx = x * (natW / rect.width);
    const my = y * (natH / rect.height);
    // Position lens centered on cursor
    zoomLens.style.left = (e.clientX - LENS_SIZE / 2) + 'px';
    zoomLens.style.top  = (e.clientY - LENS_SIZE / 2) + 'px';
    // Background size = original image dimensions × zoomLevel
    const bsW = natW * zoomLevel;
    const bsH = natH * zoomLevel;
    // Background position: center the original-resolution point in the lens
    const bpX = mx * zoomLevel - LENS_SIZE / 2;
    const bpY = my * zoomLevel - LENS_SIZE / 2;
    zoomLens.style.backgroundSize     = `${bsW}px ${bsH}px`;
    zoomLens.style.backgroundPosition = `-${bpX}px -${bpY}px`;
  });

  // Scroll wheel adjusts zoom level (1.5× – 12×)
  lightbox.addEventListener('wheel', e => {
    if (zoomLens.classList.contains('hidden')) return;
    e.preventDefault();
    zoomLevel = Math.min(8, Math.max(0.5, zoomLevel - e.deltaY * 0.005));
  }, { passive: false });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('over');
    loadFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
}

// -----------------------------------------------------------------------
// Questions file upload
// -----------------------------------------------------------------------
function setupQuestionsUpload() {
  const fileInput = document.getElementById('questionsFile');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('questionsInput').value = e.target.result;
    };
    reader.readAsText(file);
  });
}

// -----------------------------------------------------------------------
// Parse questions from textarea — one per non-blank line
// -----------------------------------------------------------------------
function parseQuestions(raw) {
  return raw.split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.match(/^#{1,6}\s/)); // skip markdown headers
}

// -----------------------------------------------------------------------
// Submit — process questions sequentially
// -----------------------------------------------------------------------
function setupSubmit() {
  document.getElementById('submitBtn').addEventListener('click', async () => {
    const raw     = document.getElementById('questionsInput').value;
    const context = document.getElementById('contextInput').value.trim();
    const questions = parseQuestions(raw);

    if (!imageDataUrl) { alert('Please upload an image first.'); return; }
    if (questions.length === 0) { alert('Please enter at least one question.'); return; }

    const params = {
      state:    document.getElementById('paramState').value,
      level:    document.getElementById('paramLevel').value,
      detail:   document.getElementById('paramDetail').value,
      thinking: document.getElementById('paramThinking').checked,
      location: document.getElementById('imageLocation').value.trim(),
      context,
    };

    // Populate print params block
    const levelLabel = { elementary: 'Elementary', middle: 'Middle School', high: 'High School', advanced: 'Advanced / College' }[params.level] || params.level;
    const detailLabel = { low: 'Low', medium: 'Medium', high: 'High' }[params.detail] || params.detail;
    document.getElementById('printParams').innerHTML = `
      <span><span class="param-label">Level</span>${levelLabel}</span>
      <span><span class="param-label">Detail</span>${detailLabel}</span>
      <span><span class="param-label">Standards</span>${escHtml(params.state)} Standards</span>
      ${params.thinking ? '<span><span class="param-label">Reasoning</span>Extended Thinking Mode</span>' : ''}
      ${params.location ? `<span><span class="param-label">Location / Source</span>${escHtml(params.location)}</span>` : ''}
    `;

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;

    // Show progress
    const progressArea = document.getElementById('progressArea');
    const progressLabel = document.getElementById('progressLabel');
    const progressBar   = document.getElementById('progressBar');
    progressArea.classList.remove('hidden');

    // Show results section (don't clear existing cards — append to them)
    const results = document.getElementById('results');
    const body    = document.getElementById('resultsBody');
    results.classList.remove('hidden');
    document.getElementById('exportRow').classList.add('hidden');

    // Store params now so buildStandardsHtml can read them during rendering
    window._curiosityParams = params;

    // Keep track of rendered cards for export
    const allAnswers = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      progressLabel.textContent = `Processing question ${i + 1} of ${questions.length}…`;
      progressBar.style.width   = `${((i) / questions.length) * 100}%`;

      // Insert skeleton card
      const cardNum = ++questionCounter;
      const cardEl = insertSkeletonCard(body, cardNum, q);

      try {
        const answer = await queryServer(q, params);
        allAnswers.push(answer);
        if (answer.type === 'image-generation') {
          renderImageCard(cardEl, cardNum, answer);
        } else {
          renderAnswerCard(cardEl, cardNum, answer);
        }
        conversationHistory.push({ question: q, answer: answer.answer || '' });
      } catch (err) {
        renderErrorCard(cardEl, q, err.message);
        allAnswers.push({ question: q, subjects: [], answer: `Error: ${err.message}`, standards: [] });
        conversationHistory.push({ question: q, answer: `Error: ${err.message}` });
      }

      progressBar.style.width = `${((i + 1) / questions.length) * 100}%`;
    }

    progressLabel.textContent = 'Done!';
    btn.disabled = false;
    document.getElementById('exportRow').classList.remove('hidden');

    // Store for export
    window._curiosityResults = allAnswers;
    window._curiosityParams = params;

    // Auto-save session to images/<name>/session.json
    saveSession(allAnswers, params);
  });
}

// -----------------------------------------------------------------------
// Query the server for one question
// -----------------------------------------------------------------------
async function queryServer(question, params) {
  const body = { image: imageDataUrl, question, params, history: conversationHistory };
  if (apiKey) body.apiKey = apiKey;

  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// -----------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------
function insertSkeletonCard(container, num, question) {
  const div = document.createElement('div');
  div.className = 'answer-card loading';
  div.innerHTML = `
    <div class="q-number">Question ${num}</div>
    <div class="q-text">${escHtml(question)}</div>
    <div class="skeleton short"></div>
    <div class="skeleton long"></div>
    <div class="skeleton long"></div>
    <div class="skeleton short"></div>
  `;
  container.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return div;
}

function renderAnswerCard(cardEl, num, answer) {
  const subjectTags = (answer.subjects || [])
    .map(s => `<a class="subject-tag" href="https://en.wikipedia.org/wiki/${encodeURIComponent(s)}" target="_blank" rel="noopener">${escHtml(s)}</a>`)
    .join('');

  const standardsHtml = buildStandardsHtml(answer.standards || []);

  cardEl.className = 'answer-card';
  cardEl.innerHTML = `
    <div class="q-number">Question ${num}</div>
    <div class="q-text">${escHtml(answer.question || '')}</div>
    <div class="subjects-row">${subjectTags}</div>
    <div class="answer-text">${DOMPurify.sanitize(marked.parse(answer.answer || ''))}</div>
    ${standardsHtml}
  `;
}

function renderImageCard(cardEl, num, answer) {
  const subjectTags = (answer.subjects || [])
    .map(s => `<a class="subject-tag" href="https://en.wikipedia.org/wiki/${encodeURIComponent(s)}" target="_blank" rel="noopener">${escHtml(s)}</a>`)
    .join('');

  const imgHtml = answer.generatedImage
    ? `<img src="${escHtml(answer.generatedImage)}" class="generated-image" alt="Generated image" />
       <a class="img-download-btn" href="${escHtml(answer.generatedImage)}" download="curiosity-generated.png">Download image</a>`
    : `<p style="color:var(--muted);font-style:italic">No image was returned by the model.</p>`;

  cardEl.className = 'answer-card';
  cardEl.innerHTML = `
    <div class="q-number">Question ${num} <span class="q-type-badge">Image Generation</span></div>
    <div class="q-text">${escHtml(answer.question || '')}</div>
    <div class="subjects-row">${subjectTags}</div>
    <div class="generated-image-wrap">${imgHtml}</div>
    ${answer.answer ? `<div class="answer-text" style="margin-top:.75rem">${DOMPurify.sanitize(marked.parse(answer.answer))}</div>` : ''}
  `;
}

function renderErrorCard(cardEl, question, message) {
  cardEl.className = 'answer-card';
  cardEl.innerHTML = `
    <div class="q-number" style="color:#dc2626">Error</div>
    <div class="q-text">${escHtml(question)}</div>
    <div class="answer-text" style="color:#dc2626">${escHtml(message)}</div>
  `;
}

function buildStandardsHtml(standards) {
  if (!standards.length) return '';
  const state = window._curiosityParams?.state || 'Florida';
  const label = state === 'Florida' ? 'Florida Educational Standards (CPALMS)'
              : state === 'National' ? 'National Educational Standards'
              : `${state} Educational Standards`;
  const items = standards.map(s => `
    <div class="standard-item">
      <span class="std-code">${escHtml(s.code || '')}</span>
      <span class="std-desc"> — ${escHtml(s.description || '')}</span><br/>
      <small>${escHtml(s.subject || '')} | Grade ${escHtml(s.gradeBand || '')}</small>
      ${s.url ? `<br/><a href="${escHtml(s.url)}" target="_blank">${escHtml(s.url)}</a>` : ''}
    </div>
  `).join('');
  return `
    <div class="standards-section">
      <h4>${escHtml(label)}</h4>
      ${items}
    </div>
  `;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// -----------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------
function setupExport() {
  document.getElementById('exportMd').addEventListener('click', exportMarkdown);
  document.getElementById('exportPdf').addEventListener('click', exportPdf);
}

function exportPdf() {
  const el = document.getElementById('resultsBody');
  if (!el || !el.children.length) { alert('No results to export yet.'); return; }
  html2pdf().set({
    margin: 10,
    filename: 'curiosity-report.pdf',
    image: { type: 'jpeg', quality: 0.97 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
  }).from(el).save();
}

// -----------------------------------------------------------------------
// Auto-save session
// -----------------------------------------------------------------------
async function saveSession(results, params) {
  try {
    // Get a descriptive label for the image to use as the folder name
    const descBody = { image: imageDataUrl };
    if (apiKey) descBody.apiKey = apiKey;
    const descRes = await fetch('/api/describe-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(descBody),
    });
    const { label } = await descRes.json();
    const folderName = label || imageName?.replace(/\.[^.]+$/, '') || 'untitled';

    const body = {
      imageName: folderName,
      image: imageDataUrl,
      params,
      questions: results,
    };
    const res = await fetch('/api/save-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.saved) {
      console.log(`Session saved to ${data.folder}`);
      window._sessionFolder = data.folder;
    }
  } catch (err) {
    console.warn('Session save failed:', err.message);
  }
}

async function exportMarkdown() {
  const results = window._curiosityResults;
  if (!results || results.length === 0) { alert('No results to export yet.'); return; }

  const params = {
    state:  document.getElementById('paramState').value,
    level:  document.getElementById('paramLevel').value,
    detail: document.getElementById('paramDetail').value,
  };

  let md = '';
  const levelLabel = { elementary: 'Elementary', middle: 'Middle School', high: 'High School', advanced: 'Advanced / College' }[params.level] || params.level;
  const detailLabel = { low: 'Low', medium: 'Medium', high: 'High' }[params.detail] || params.detail;

  md += `# Curious Jack\n\n`;
  md += `*fostered by Paul Fishwick and Claude Code*\n\n`;
  if (imageName) md += `*Image: ${imageName}*\n\n`;
  md += `---\n\n`;
  md += `**Level:** ${levelLabel}  \n`;
  md += `**Detail:** ${detailLabel}  \n`;
  md += `**Standards:** ${params.state} Standards  \n`;
  if (params.thinking) md += `**Reasoning:** Extended Thinking Mode  \n`;
  if (params.location) md += `**Location / Source:** ${params.location}  \n`;
  md += `\n---\n\n`;

  results.forEach((a, i) => {
    md += `## Question ${i + 1}\n\n`;
    md += `**${a.question}**\n\n`;
    if (a.subjects && a.subjects.length) {
      md += `**Subjects:** ${a.subjects.join(', ')}\n\n`;
    }
    md += `${a.answer}\n\n`;
    if (a.standards && a.standards.length) {
      const stdLabel = params.state === 'Florida' ? 'Florida Educational Standards (CPALMS)'
                     : params.state === 'National' ? 'National Educational Standards'
                     : `${params.state} Educational Standards`;
      md += `### ${stdLabel}\n\n`;
      a.standards.forEach(s => {
        md += `- **${s.code}** — ${s.description}  \n`;
        md += `  *${s.subject} | Grade ${s.gradeBand}*  \n`;
        if (s.url) md += `  ${s.url}\n`;
      });
      md += '\n';
    }
    md += '---\n\n';
  });

  const blob = new Blob([md], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'curiosity-report.md';
  a.click();
  URL.revokeObjectURL(url);
}
