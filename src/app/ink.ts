// The reveal "ink" effect draws the headword letter by letter in its final layout, so the word
// never changes its lines while it animates. Letters start pushed apart from their line's centre
// (like wide letter-spacing) and gather into place; ones pushed past the card are clipped by it.

export type InkLetter = {
  ch: string;
  // Position of the letter's box relative to the headword element, in layout pixels.
  x: number;
  y: number;
  // Start offset: how far the letter is pushed sideways before it gathers in.
  dx: number;
  line: number;
  // Offset of the character in the headword's text; -1 for a hyphen the browser added.
  index: number;
};

type Measured = Omit<InkLetter, 'dx'>;

// Push each letter away from its line's centre in proportion to its place in the line, as if
// `spread` pixels of letter-spacing were added between every pair of characters.
export function inkOffsets<T extends { line: number }>(letters: T[], spread: number) {
  const counts = new Map<number, number>();
  for (const l of letters) counts.set(l.line, (counts.get(l.line) ?? 0) + 1);
  const seen = new Map<number, number>();
  return letters.map((l) => {
    const index = seen.get(l.line) ?? 0;
    seen.set(l.line, index + 1);
    return (index - ((counts.get(l.line) ?? 1) - 1) / 2) * spread;
  });
}

// Move each drawn letter by the difference measured against the real text. A hyphen has no
// character of its own, so it follows the last measured letter of its line.
export function applyCorrections(
  letters: InkLetter[],
  corrections: ({ dx: number; dy: number } | null)[],
): InkLetter[] {
  const byLine = new Map<number, { dx: number; dy: number }>();
  letters.forEach((l, i) => {
    const c = corrections[i];
    if (c) byLine.set(l.line, c);
  });
  return letters.map((l, i) => {
    const c = corrections[i] ?? byLine.get(l.line);
    return c ? { ...l, x: l.x + c.dx, y: l.y + c.dy } : l;
  });
}

const isLetter = (ch: string) => /\S/.test(ch) && ch !== '-' && ch !== '‐';

// The card's own animations (rise, flip) use 3D transforms that would distort measured boxes, so
// they are paused while measuring and restart in the same frame (they are just starting anyway).
function withCardPaused<T>(card: HTMLElement, measure: () => T): T {
  const previous = { animation: card.style.animation, transform: card.style.transform };
  card.style.animation = 'none';
  card.style.transform = 'none';
  try {
    return measure();
  } finally {
    card.style.animation = previous.animation;
    card.style.transform = previous.transform;
  }
}

function frame(title: HTMLElement) {
  const base = title.getBoundingClientRect();
  // Any remaining scale on an ancestor is uniform; divide it out.
  return { base, scale: base.width / title.offsetWidth || 1 };
}

// Measure where every character of `title`'s text sits once laid out, including the hyphen the
// browser adds when it breaks a word across lines.
export function measureInk(title: HTMLElement, card: HTMLElement, spreadEm: number): InkLetter[] {
  const node = title.firstChild;
  if (!(node instanceof Text) || !node.data) return [];
  return withCardPaused(card, () => {
    const { base, scale } = frame(title);
    if (!base.width) return [];
    const range = document.createRange();
    const measured: Measured[] = [];
    const text = node.data;
    let lineTops: number[] = [];
    const lineOf = (top: number) => {
      let line = lineTops.findIndex((t) => Math.abs(t - top) < 2);
      if (line < 0) {
        lineTops = [...lineTops, top];
        line = lineTops.length - 1;
      }
      return line;
    };
    let previousLetter: { line: number; right: number; top: number } | null = null;
    for (let i = 0; i < text.length;) {
      const ch = String.fromCodePoint(text.codePointAt(i)!),
        index = i;
      range.setStart(node, i);
      range.setEnd(node, i + ch.length);
      i += ch.length;
      const rect = range.getClientRects()[0];
      if (!rect || !rect.width) {
        previousLetter = null;
        continue;
      }
      const top = (rect.top - base.top) / scale,
        left = (rect.left - base.left) / scale,
        line = lineOf(top);
      // A break inside a word means the browser drew a hyphen at the end of the earlier line.
      if (previousLetter && previousLetter.line !== line && isLetter(ch))
        measured.push({
          ch: '-',
          x: previousLetter.right,
          y: previousLetter.top,
          line: previousLetter.line,
          index: -1,
        });
      if (/\S/.test(ch)) measured.push({ ch, x: left, y: top, line, index });
      previousLetter = isLetter(ch) ? { line, right: (rect.right - base.left) / scale, top } : null;
    }
    // Keep each line's letters in reading order so offsets grow outward from its centre.
    measured.sort((a, b) => a.line - b.line || a.x - b.x);
    const spread = spreadEm * parseFloat(getComputedStyle(title).fontSize);
    const offsets = inkOffsets(measured, spread);
    return measured.map((m, i) => ({ ...m, dx: offsets[i] }));
  });
}

// Once the letters are drawn, compare each with the same character of the real text and correct
// the difference. Fonts and browsers place a lone letter and a letter in running text slightly
// differently (vertical metrics), so this keeps the drawn word where the real one lies.
export function calibrateInk(
  title: HTMLElement,
  card: HTMLElement,
  layer: HTMLElement,
  letters: InkLetter[],
): InkLetter[] {
  const node = title.firstChild;
  if (!(node instanceof Text)) return letters;
  return withCardPaused(card, () => {
    // Letters must be measured at rest, not at their pushed-apart start.
    layer.classList.add('ink-measuring');
    try {
      const { scale } = frame(title);
      const drawn = layer.querySelectorAll<HTMLElement>('.ink-letter'),
        range = document.createRange();
      const corrections = letters.map((l, i) => {
        if (l.index < 0 || !drawn[i]) return null;
        range.setStart(node, l.index);
        range.setEnd(node, l.index + l.ch.length);
        const real = range.getClientRects()[0],
          box = drawn[i].getBoundingClientRect();
        return real
          ? { dx: (real.left - box.left) / scale, dy: (real.top - box.top) / scale }
          : null;
      });
      return applyCorrections(letters, corrections);
    } finally {
      layer.classList.remove('ink-measuring');
    }
  });
}

// Place a letter on a whole device pixel, so it is drawn the same way in every frame.
export const snapToPixel = (value: number, pixelRatio: number) => {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  return Math.round(value * ratio) / ratio;
};
