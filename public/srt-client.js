// Browser-side SRT parse/rebuild (mirror of server srt.js). Indices and
// timecodes are preserved verbatim; only cue text is ever changed.
(function () {
  function stripBom(s) {
    return s.replace(/^﻿/, '');
  }

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

      if (/^\d+$/.test(lines[i].trim())) {
        index = lines[i].trim();
        i++;
      }

      let time = null;
      if (lines[i] && lines[i].includes('-->')) {
        time = lines[i].trim();
        i++;
      }

      const content = lines.slice(i).join('\n');
      if (time === null) continue;

      cues.push({ index: index, time: time, text: content });
    }
    return cues;
  }

  function buildSrt(cues) {
    return cues
      .map(function (c, n) {
        const idx = c.index != null ? c.index : String(n + 1);
        return idx + '\n' + c.time + '\n' + c.text;
      })
      .join('\n\n') + '\n';
  }

  window.SRT = { parseSrt: parseSrt, buildSrt: buildSrt };
})();
