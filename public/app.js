// Client logic: collect inputs, stream translation progress over SSE, show result.

const $ = (id) => document.getElementById(id);

const fileInput = $('file');
const drop = $('drop');
const dropText = $('dropText');
const fileMeta = $('fileMeta');
const go = $('go');
const statusEl = $('status');
const progressWrap = $('progressWrap');
const bar = $('bar');
const progressText = $('progressText');
const resultCard = $('resultCard');
const resultEl = $('result');
const downloadBtn = $('download');
const accessCodeEl = $('accessCode');

let srtContent = '';
let fileName = '';
let translatedSrt = '';

// Remember the access code on this browser for convenience.
accessCodeEl.value = localStorage.getItem('zirnevis_access') || '';
accessCodeEl.addEventListener('input', () => localStorage.setItem('zirnevis_access', accessCodeEl.value));

function setStatus(msg, cls = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + cls;
}

function refreshReady() {
  go.disabled = !(srtContent && $('source').value.trim() && $('target').value.trim());
}
['source', 'target'].forEach((id) => $(id).addEventListener('input', refreshReady));

// ---- File handling ----
function loadFile(file) {
  if (!file) return;
  if (!/\.srt$/i.test(file.name) && file.type !== 'text/plain') {
    setStatus('لطفاً یک فایل ‎.srt‎ انتخاب کنید', 'err');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    srtContent = reader.result;
    fileName = file.name;
    const cues = (srtContent.match(/-->/g) || []).length;
    dropText.textContent = file.name;
    fileMeta.textContent = `✔ بارگذاری شد — حدود ${cues.toLocaleString('fa')} پاراگراف`;
    setStatus('');
    refreshReady();
  };
  reader.readAsText(file, 'utf-8');
}

fileInput.addEventListener('change', (e) => loadFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); })
);
drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

// ---- Translate (SSE stream) ----
go.addEventListener('click', async () => {
  const accessCode = accessCodeEl.value.trim();
  const tone = document.querySelector('input[name="tone"]:checked').value;
  const source = $('source').value.trim();
  const target = $('target').value.trim();

  go.disabled = true;
  resultCard.hidden = true;
  progressWrap.hidden = false;
  bar.style.width = '0%';
  progressText.textContent = 'در حال آماده‌سازی...';
  setStatus('در حال ترجمه...', '');

  // Parse the SRT in the browser so we can drive many SHORT batch requests.
  const cues = SRT.parseSrt(srtContent);
  const translatable = cues
    .map((c, i) => ({ i, text: c.text.trim() }))
    .filter((c) => c.text.length > 0);

  if (translatable.length === 0) {
    setStatus('هیچ پاراگراف معتبری در فایل پیدا نشد', 'err');
    progressWrap.hidden = true;
    go.disabled = false;
    return;
  }

  // Split into small batches; each is one short request.
  const BATCH = 12;
  const CONCURRENCY = 3;
  const batches = [];
  for (let s = 0; s < translatable.length; s += BATCH) {
    batches.push(translatable.slice(s, s + BATCH));
  }

  const total = translatable.length;
  let done = 0;
  const results = new Map(); // cue index -> translated text
  let firstError = null;

  progressText.textContent = `شروع ترجمه ${total.toLocaleString('fa')} پاراگراف...`;

  async function sendBatch(batch) {
    const items = batch.map((c) => ({ id: c.i, text: cues[c.i].text }));
    const res = await fetch('/api/translate-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, source, target, tone, accessCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err.error || `خطای سرور (${res.status})`);
      e.status = res.status;
      throw e;
    }
    const data = await res.json();
    for (const it of data.items) results.set(Number(it.id), it.t);
  }

  async function processBatch(batch) {
    // Two attempts per batch; a single dropped request won't kill the whole job.
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await sendBatch(batch);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        // Don't retry on auth/config errors — they won't fix themselves.
        if (err.status === 401 || err.status === 500) break;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (lastErr) {
      if (!firstError) firstError = lastErr;
      // Keep original text for this batch so the file stays complete.
      for (const c of batch) if (!results.has(c.i)) results.set(c.i, cues[c.i].text);
    }
    done += batch.length;
    const pct = Math.round((done / total) * 100);
    bar.style.width = pct + '%';
    progressText.textContent = `${done.toLocaleString('fa')} از ${total.toLocaleString('fa')} پاراگراف — ٪${pct.toLocaleString('fa')}`;
  }

  // Simple concurrency pool.
  try {
    let cursor = 0;
    async function worker() {
      while (cursor < batches.length) {
        const my = batches[cursor++];
        await processBatch(my);
        // Stop early on a fatal auth/config error.
        if (firstError && (firstError.status === 401 || firstError.status === 500)) return;
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

    // Fatal error (bad code / server not configured): surface it, no output.
    if (firstError && (firstError.status === 401 || firstError.status === 500)) {
      throw firstError;
    }

    const outCues = cues.map((c, i) => ({
      ...c,
      text: results.has(i) ? results.get(i) : c.text,
    }));
    translatedSrt = SRT.buildSrt(outCues);
    resultEl.textContent = translatedSrt;
    resultCard.hidden = false;
    bar.style.width = '100%';

    if (firstError) {
      setStatus('ترجمه کامل شد، اما بخشی از پاراگراف‌ها ترجمه نشدند (متن اصلی حفظ شد)', 'err');
      progressText.textContent = 'با چند خطای موقت به پایان رسید.';
    } else {
      setStatus('ترجمه کامل شد ✔', 'ok');
      progressText.textContent = 'انجام شد.';
    }
    resultCard.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    setStatus(err.message || 'خطا در ترجمه', 'err');
    progressWrap.hidden = true;
  } finally {
    go.disabled = false;
  }
});

// ---- Download ----
downloadBtn.addEventListener('click', () => {
  const blob = new Blob([translatedSrt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const base = fileName.replace(/\.srt$/i, '') || 'subtitle';
  a.href = url;
  a.download = `${base}.translated.srt`;
  a.click();
  URL.revokeObjectURL(url);
});
