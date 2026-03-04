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
        // Auto-play TTS if Read Aloud is checked
        if (document.getElementById('paramVoiceEnabled').checked && answer.answer) {
          progressLabel.textContent = `Processing audio for question ${i + 1}…`;
          const ttsBtn = cardEl.querySelector('.tts-btn');
          if (ttsBtn) await playTts(ttsBtn, answer.answer);
        }
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
  const standardsHtml = buildStandardsHtml(answer.standards || []);
  const sanitizedAnswer = DOMPurify.sanitize(marked.parse(answer.answer || ''));

  cardEl.className = 'answer-card';
  cardEl.textContent = '';

  const qNum = document.createElement('div');
  qNum.className = 'q-number';
  qNum.textContent = 'Question ' + num + ' ';
  const ttsBtn = document.createElement('button');
  ttsBtn.className = 'tts-btn';
  ttsBtn.title = 'Read aloud';
  ttsBtn.textContent = '\u{1F50A}';
  ttsBtn.addEventListener('click', () => playTts(ttsBtn, answer.answer || ''));
  qNum.appendChild(ttsBtn);
  cardEl.appendChild(qNum);

  const qText = document.createElement('div');
  qText.className = 'q-text';
  qText.textContent = answer.question || '';
  cardEl.appendChild(qText);

  const subjRow = document.createElement('div');
  subjRow.className = 'subjects-row';
  (answer.subjects || []).forEach(s => {
    const a = document.createElement('a');
    a.className = 'subject-tag';
    a.href = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(s);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = s;
    subjRow.appendChild(a);
  });
  cardEl.appendChild(subjRow);

  const ansDiv = document.createElement('div');
  ansDiv.className = 'answer-text';
  ansDiv.innerHTML = sanitizedAnswer;
  cardEl.appendChild(ansDiv);

  if (standardsHtml) {
    const stdWrapper = document.createElement('div');
    stdWrapper.innerHTML = DOMPurify.sanitize(standardsHtml);
    while (stdWrapper.firstChild) cardEl.appendChild(stdWrapper.firstChild);
  }
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
// TTS — strip markdown and play audio
// -----------------------------------------------------------------------
function stripMarkdown(md) {
  return md
    .replace(/#{1,6}\s+/g, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')     // bold
    .replace(/\*(.+?)\*/g, '$1')         // italic
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')           // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // images
    .replace(/^[-*+]\s+/gm, '')          // list bullets
    .replace(/^\d+\.\s+/gm, '')          // numbered lists
    .replace(/^>\s+/gm, '')              // blockquotes
    .replace(/---+/g, '')                // horizontal rules
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function playTts(button, text) {
  if (button.dataset.playing === 'true') return;
  button.dataset.playing = 'true';
  button.textContent = '⏳';

  try {
    const voice = document.getElementById('paramVoice').value;
    const body = { text: stripMarkdown(text).slice(0, 4000), voice };
    if (apiKey) body.apiKey = apiKey;

    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    button.textContent = '⏹';

    audio.onended = () => {
      button.textContent = '🔊';
      button.dataset.playing = 'false';
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => {
      button.textContent = '🔊';
      button.dataset.playing = 'false';
      URL.revokeObjectURL(url);
    };

    audio.play();
  } catch (err) {
    console.error('TTS error:', err.message);
    alert('TTS failed: ' + err.message);
    button.textContent = '🔊';
    button.dataset.playing = 'false';
  }
}

// -----------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------
function setupExport() {
  document.getElementById('exportMd').addEventListener('click', exportMarkdown);
  document.getElementById('exportPdf').addEventListener('click', exportPdf);
}

function exportPdf() {
  const resultsBody = document.getElementById('resultsBody');
  if (!resultsBody || !resultsBody.children.length) { alert('No results to export yet.'); return; }

  const header = document.getElementById('printImageHeader');
  const css = document.querySelector('link[rel="stylesheet"]').href;

  // Build standalone HTML for print
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Curious Jack Report</title>
    <link rel="stylesheet" href="${css}">
    <style>
      body { background: #fff; font-family: 'Söhne', system-ui, sans-serif; color: #1a1209; padding: 20px; }
      .print-image-header { display: block !important; text-align: center; margin-bottom: 2rem; }
      .print-banner { width: 100%; max-height: 150px; object-fit: contain; display: block; margin: 0 auto .5rem; }
      .print-title { font-size: 2rem; font-weight: 700; margin-bottom: .3rem; }
      .print-byline { font-size: .9rem; color: #555; font-style: italic; margin-bottom: 1rem; }
      .print-params { font-size: .85rem; color: #333; margin: 1rem 0; border-top: 1px solid #ccc; padding-top: .75rem; }
      .print-params span { display: inline-block; margin-right: 1.5rem; }
      .print-params .param-label { font-weight: 700; text-transform: uppercase; font-size: .72rem; letter-spacing: .06em; color: #888; display: block; }
      #printImage { max-width: 100%; max-height: 400px; object-fit: contain; border: 1px solid #ccc; border-radius: 6px; }
      .answer-card { background: #fff; border: 1px solid #e5ddd4; border-radius: 12px; padding: 1.5rem 1.75rem; margin-bottom: 1.25rem; break-inside: avoid; }
      .answer-card .q-number { font-size: .7rem; font-weight: 700; color: #c96442; text-transform: uppercase; letter-spacing: .1em; margin-bottom: .4rem; }
      .answer-card .q-text { font-size: 1.05rem; font-weight: 600; margin-bottom: .9rem; }
      .subjects-row { display: flex; flex-wrap: wrap; gap: .4rem; margin-bottom: 1rem; }
      .subject-tag { background: #fde8dc; color: #9a3412; border-radius: 99px; padding: .18rem .7rem; font-size: .75rem; font-weight: 600; text-decoration: none; }
      .answer-text { font-size: .95rem; line-height: 1.75; }
      .answer-text p { margin-bottom: .75rem; }
      .answer-text ul, .answer-text ol { margin: .5rem 0 .75rem 1.4rem; }
      .answer-text li { margin-bottom: .3rem; }
      .standards-section { margin-top: 1.35rem; border-top: 1px solid #e5ddd4; padding-top: 1rem; }
      .standards-section h4 { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: #7a6a5a; margin-bottom: .7rem; }
      .standard-item { font-size: .85rem; line-height: 1.6; margin-bottom: .6rem; }
      .standard-item .std-code { font-weight: 700; color: #c96442; }
      .tts-btn { display: none; }
      @media print { body { margin: 0; } .answer-card { box-shadow: none; } }
    </style>
  </head><body>
    ${header.outerHTML.replace('class="print-image-header"', 'class="print-image-header" style="display:block"')}
    ${resultsBody.outerHTML}
  </body></html>`;

  const old = document.getElementById('pdf-print-frame');
  if (old) old.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'pdf-print-frame';
  iframe.style.cssText = 'position:fixed;left:-9999px;width:0;height:0';
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    try { iframe.contentWindow.print(); } catch { alert('Press Cmd+P to save as PDF'); }
  };
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

function shrinkImage(dataUrl, maxWidth) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.4));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
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
  if (imageDataUrl) {
    const thumbUrl = await shrinkImage(imageDataUrl, 400);
    md += `<img src="${thumbUrl}" alt="${imageName || 'Image'}" width="400" />\n\n`;
  }
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
