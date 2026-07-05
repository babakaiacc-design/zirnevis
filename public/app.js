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

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ srt: srtContent, source, target, tone, accessCode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `خطای سرور (${res.status})`);
    }

    // Parse the SSE stream manually.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const chunks = buffer.split('\n\n');
      buffer = chunks.pop();
      for (const chunk of chunks) {
        const evMatch = chunk.match(/^event: (.+)$/m);
        const dataMatch = chunk.match(/^data: (.+)$/m);
        if (!evMatch || !dataMatch) continue;
        const event = evMatch[1].trim();
        const data = JSON.parse(dataMatch[1]);
        handleEvent(event, data);
      }
    }
  } catch (err) {
    setStatus(err.message || 'خطا در ترجمه', 'err');
    progressWrap.hidden = true;
  } finally {
    go.disabled = false;
  }
});

function handleEvent(event, data) {
  if (event === 'start') {
    progressText.textContent = `شروع ترجمه ${Number(data.total).toLocaleString('fa')} پاراگراف...`;
  } else if (event === 'progress') {
    const pct = Math.round((data.done / data.total) * 100);
    bar.style.width = pct + '%';
    progressText.textContent = `${data.done.toLocaleString('fa')} از ${data.total.toLocaleString('fa')} پاراگراف — ٪${pct.toLocaleString('fa')}`;
  } else if (event === 'done') {
    bar.style.width = '100%';
    translatedSrt = data.srt;
    resultEl.textContent = translatedSrt;
    resultCard.hidden = false;
    setStatus('ترجمه کامل شد ✔', 'ok');
    progressText.textContent = 'انجام شد.';
    resultCard.scrollIntoView({ behavior: 'smooth' });
  } else if (event === 'error') {
    setStatus(data.message || 'خطا در ترجمه', 'err');
    progressWrap.hidden = true;
  }
}

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
