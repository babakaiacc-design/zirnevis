// SRT parsing / reassembly. Timecodes and indices are preserved verbatim;
// only the text content of each cue is ever touched.

function stripBom(s) {
  return s.replace(/^﻿/, '');
}

// Parse an SRT string into an array of cues:
//   { index: "1", time: "00:00:00,100 --> 00:00:02,020", text: "line1\nline2" }
// `index` and `time` are kept as raw strings so we can round-trip them untouched.
function parseSrt(input) {
  const text = stripBom(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const raw = block.replace(/^\n+|\n+$/g, '');
    if (!raw) continue;

    const lines = raw.split('\n');
    let i = 0;
    let index = null;

    // First line is the numeric index (optional in some malformed files).
    if (/^\d+$/.test(lines[i].trim())) {
      index = lines[i].trim();
      i++;
    }

    // Next line should contain the timecode arrow.
    let time = null;
    if (lines[i] && lines[i].includes('-->')) {
      time = lines[i].trim();
      i++;
    }

    const content = lines.slice(i).join('\n');

    // Only treat as a real cue if we found a timecode; otherwise skip stray text.
    if (time === null) continue;

    cues.push({ index, time, text: content });
  }

  return cues;
}

// Rebuild an SRT string from cues, keeping index + time exactly as parsed.
function buildSrt(cues) {
  return cues
    .map((c, n) => {
      const idx = c.index != null ? c.index : String(n + 1);
      return `${idx}\n${c.time}\n${c.text}`;
    })
    .join('\n\n') + '\n';
}

module.exports = { parseSrt, buildSrt };
