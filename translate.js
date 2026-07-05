// Translation engine: batches SRT cues and translates them with the Claude API,
// preserving cue order/count and following the tone + proper-noun rules.

const API_URL = 'https://api.anthropic.com/v1/messages';

const TONES = {
  street: {
    fa: 'محاوره‌ای و کوچه‌بازاری',
    guide:
      'Very casual, colloquial "street" register. Use everyday spoken slang and ' +
      'idioms of the TARGET language, contractions, and broken/spoken forms. ' +
      'For Persian this means شکسته‌نویسی و لحن کاملاً خودمونی و کوچه‌بازاری تهرانی ' +
      '(مثل: میخوام، نمیدونم، بریم تو کارش). Keep it natural, not vulgar.',
  },
  classy: {
    fa: 'محاوره‌ای اما باکلاس و شیک',
    guide:
      'Conversational and friendly, but elegant, polished and classy. Spoken ' +
      'register WITHOUT low slang. For Persian: محاوره‌ای و صمیمی ولی شیک و مؤدب، ' +
      'شکسته‌نویسی نرم و باوقار، بدون الفاظ کوچه‌بازاری.',
  },
  formal: {
    fa: 'رسمی و حقوقی',
    guide:
      'Strictly formal, written, legal/administrative register. No contractions, ' +
      'no spoken forms. For Persian: کاملاً رسمی و مکتوب و حقوقی، بدون شکسته‌نویسی، ' +
      'با ادبیات دقیق و رسمی.',
  },
};

function buildSystemPrompt(source, target, toneKey) {
  const tone = TONES[toneKey] || TONES.classy;
  return `You are an expert subtitle translator. You translate from ${source} to ${target}.

TONE / REGISTER (apply to the ${target} output):
${tone.guide}

HARD RULES:
1. The translation must be fluent, natural and idiomatic in ${target} — never a literal word-for-word rendering. It should read as if originally written in ${target}.
2. Proper nouns and brand/product/technology names that are in Latin/English letters must NOT be left in Latin letters inside the ${target} sentence (they break the flow). Instead, transliterate them phonetically into ${target} script and wrap them in quotation marks.
   Examples (English -> Persian):
     Claude Cowork  -> "کلاود کوورک"
     N8N            -> "ان ایت ان"
     Claude Code    -> "کلاود کد"
   Apply the same idea for any target language: phonetic transliteration in quotes.
3. Keep each segment's meaning; do not merge, split, drop, or reorder segments.
4. Preserve the segment count exactly. Every input id MUST appear once in the output — never skip or omit any id, even short ones.
5. Do NOT add explanations, notes, or extra text. Translate ONLY the content.
6. Translate EVERY segment fully into ${target}. Never leave source-language (English/Latin) words in the output — the ONLY Latin-script exception is a proper noun, which must be transliterated into ${target} and wrapped in quotes.
7. PUNCTUATION: Do NOT end a line or a segment with a period, comma (، or ,), exclamation mark, semicolon, colon, or ellipsis (…/...). The ONLY punctuation allowed at the end is a question mark (؟) when the sentence is a question. Otherwise leave the end with no punctuation.
8. LINE LENGTH: If a translated segment is long, split it into 2 or 3 short lines using a line break between them — do not put a long translation on one single long line. Keep each line short and easy to read.

OUTPUT FORMAT:
Return ONLY a JSON array. Each element: {"id": <number>, "t": "<translated text>"}.
No markdown, no code fences, no commentary — just the raw JSON array.`;
}

// Extract a JSON array from a model response, tolerating stray text/fences.
function extractJsonArray(str) {
  let s = str.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON array found in model response');
  }
  return JSON.parse(s.slice(start, end + 1));
}

async function callClaude({ apiKey, model, system, userText }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      messages: [{ role: 'user', content: userText }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body.slice(0, 400)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return text;
}

// Translate one batch of cues -> map of id -> translated text.
async function translateBatch({ apiKey, model, system, batch }) {
  const payload = batch.map((c) => ({ id: c.id, t: c.text }));
  const userText =
    'Translate the "t" field of each object below. Return the JSON array as instructed.\n\n' +
    JSON.stringify(payload, null, 0);

  const raw = await callClaude({ apiKey, model, system, userText });
  const arr = extractJsonArray(raw);
  const map = new Map();
  for (const item of arr) {
    if (item && typeof item.id !== 'undefined') {
      map.set(Number(item.id), typeof item.t === 'string' ? item.t : '');
    }
  }
  return map;
}

// Remove sentence-ending punctuation (except question marks) from every line's
// end, per the requested Persian subtitle convention. Leading/trailing spaces
// are trimmed per line but line breaks are kept.
function cleanupText(text) {
  return String(text)
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]+$/u, '')
        // strip trailing . , ، ! ; ؛ : … and repeated dots — but never ? or ؟
        .replace(/[.,،!;؛:…]+$/u, '')
        .replace(/[ \t]+$/u, '')
    )
    .join('\n');
}

// Stateless single-batch translate for the client-driven (short-request) flow.
// `items` is [{ id, text }]; returns [{ id, t }] in the same order. Throws on API error.
async function translateItems({ apiKey, model = 'claude-sonnet-5', source, target, tone, items }) {
  const system = buildSystemPrompt(source, target, tone);
  const map = await translateBatch({
    apiKey, model, system,
    batch: items.map((it) => ({ id: it.id, text: it.text })),
  });

  // Any id the model skipped or returned empty for gets a focused retry BEFORE
  // we ever fall back to the untranslated (English) original — this is the main
  // reason source text used to leak into the output.
  const isMissing = (it) => {
    const t = map.get(Number(it.id));
    return !(typeof t === 'string' && t.trim().length);
  };
  const missing = items.filter(isMissing);
  if (missing.length) {
    try {
      const retry = await translateBatch({
        apiKey, model, system,
        batch: missing.map((it) => ({ id: it.id, text: it.text })),
      });
      for (const [k, v] of retry) {
        if (typeof v === 'string' && v.trim().length) map.set(k, v);
      }
    } catch (e) {
      /* keep whatever we have; original text is the last resort below */
    }
  }

  return items.map((it) => {
    const t = map.get(Number(it.id));
    const finalText = typeof t === 'string' && t.trim().length ? t : it.text;
    return { id: it.id, t: cleanupText(finalText) };
  });
}

// Translate all cues in batches. `onProgress(done, total)` is called after each batch.
// Returns a new array of cues with translated text (index/time untouched by caller).
async function translateCues({
  apiKey,
  model = 'claude-sonnet-5',
  source,
  target,
  tone,
  cues,
  batchSize = 20,
  onProgress = () => {},
}) {
  const system = buildSystemPrompt(source, target, tone);

  // Only translate cues that actually have text.
  const translatable = cues
    .map((c, i) => ({ i, text: c.text.trim() }))
    .filter((c) => c.text.length > 0);

  const total = translatable.length;
  const results = new Map(); // cue index -> translated text
  let done = 0;
  let failedBatches = 0;
  let batchNo = 0;

  for (let start = 0; start < translatable.length; start += batchSize) {
    batchNo++;
    const slice = translatable.slice(start, start + batchSize);
    const batch = slice.map((c) => ({ id: c.i, text: cues[c.i].text }));

    let map = null;
    let lastErr = null;
    // Try once, retry once on failure.
    for (let attempt = 0; attempt < 2 && map === null; attempt++) {
      try {
        map = await translateBatch({ apiKey, model, system, batch });
      } catch (err) {
        lastErr = err;
        console.error(`[translate] batch ${batchNo} attempt ${attempt + 1} failed:`, err.message);
      }
    }

    if (map === null) {
      // The very first batch failing almost always means a config problem
      // (bad key, no credit, wrong model). Surface the real error instead of
      // silently returning the untranslated original and claiming success.
      if (batchNo === 1) {
        throw lastErr || new Error('Translation failed on the first batch');
      }
      failedBatches++;
      map = new Map();
    }

    for (const c of slice) {
      const translated = map.get(c.i);
      results.set(c.i, typeof translated === 'string' && translated.length ? translated : cues[c.i].text);
    }

    done += slice.length;
    onProgress(done, total);
  }

  if (failedBatches > 0) {
    console.error(`[translate] ${failedBatches} batch(es) failed; those cues kept original text.`);
  }

  return cues.map((c, i) => ({
    ...c,
    text: results.has(i) ? results.get(i) : c.text,
  }));
}

module.exports = { translateCues, translateItems, TONES };
