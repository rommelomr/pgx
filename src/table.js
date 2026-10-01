import pc from 'picocolors';

const STYLES = {
  unicode: { tl: '┌', tm: '┬', tr: '┐', ml: '├', mm: '┼', mr: '┤', bl: '└', bm: '┴', br: '┘', h: '─', v: '│' },
  ascii: { tl: '+', tm: '+', tr: '+', ml: '+', mm: '+', mr: '+', bl: '+', bm: '+', br: '+', h: '-', v: '|' },
};

// PGX_ASCII=1 fuerza caracteres ASCII puros (+, -, |)
const S = process.env.PGX_ASCII === '1' ? STYLES.ascii : STYLES.unicode;

// Tipos numéricos de Postgres (se alinean a la derecha)
const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 790, 1700]);

const MIN_COL_WIDTH = 8;

const len = (s) => [...s].length;

function truncate(s, w) {
  const chars = [...s];
  return chars.length <= w ? s : chars.slice(0, w - 1).join('') + '…';
}

function pad(s, w, align = 'left') {
  const gap = w - len(s);
  if (gap <= 0) return s;
  if (align === 'right') return ' '.repeat(gap) + s;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + s + ' '.repeat(gap - left);
  }
  return s + ' '.repeat(gap);
}

export function formatValue(v) {
  if (v === null || v === undefined) return { text: 'NULL', isNull: true };
  let text;
  if (Buffer.isBuffer(v)) text = '\\x' + v.toString('hex');
  else if (v instanceof Date) text = v.toISOString();
  else if (typeof v === 'object') text = JSON.stringify(v);
  else text = String(v);
  text = text.replace(/\r?\n/g, '↵').replace(/\t/g, ' ');
  return { text, isNull: false };
}

/**
 * Dibuja una tabla con cuadrícula.
 * @param fields  Array de { name, dataTypeID } (res.fields de pg)
 * @param rows    Array de arrays (rowMode: 'array')
 */
export function renderTable(fields, rows, { maxCellWidth = 40 } = {}) {
  const names = fields.map((f) => f.name);
  const aligns = fields.map((f) => (NUMERIC_OIDS.has(f.dataTypeID) ? 'right' : 'left'));

  const body = rows.map((row) =>
    names.map((_, i) => {
      const { text, isNull } = formatValue(row[i]);
      return { text: truncate(text, maxCellWidth), isNull };
    })
  );

  const widths = names.map((n, i) =>
    Math.max(len(truncate(n, maxCellWidth)), ...body.map((r) => len(r[i].text)), 1)
  );

  // Si la tabla es más ancha que la terminal, se encogen las columnas más anchas
  const termCols = process.stdout.columns || 120;
  const total = () => widths.reduce((a, b) => a + b + 3, 0) + 1;
  while (total() > termCols) {
    const max = Math.max(...widths);
    if (max <= MIN_COL_WIDTH) break;
    widths[widths.indexOf(max)]--;
  }

  const line = (l, m, r) => l + widths.map((w) => S.h.repeat(w + 2)).join(m) + r;
  const out = [];

  out.push(pc.cyan(line(S.tl, S.tm, S.tr)));
  out.push(
    pc.cyan(S.v) +
      names
        .map((n, i) => ' ' + pc.bold(pc.cyan(pad(truncate(n, widths[i]), widths[i], 'center'))) + ' ')
        .join(pc.cyan(S.v)) +
      pc.cyan(S.v)
  );
  out.push(pc.cyan(line(S.ml, S.mm, S.mr)));

  for (const row of body) {
    out.push(
      pc.cyan(S.v) +
        row
          .map((c, i) => {
            const padded = pad(truncate(c.text, widths[i]), widths[i], aligns[i]);
            return ' ' + (c.isNull ? pc.dim(padded) : padded) + ' ';
          })
          .join(pc.cyan(S.v)) +
        pc.cyan(S.v)
    );
  }

  out.push(pc.cyan(line(S.bl, S.bm, S.br)));
  return out.join('\n');
}

/** Caja simple con título/líneas de texto (para banner y encabezados). */
export function drawBox(lines, color = pc.cyan) {
  const width = Math.max(...lines.map((l) => len(l)));
  const top = color(S.tl + S.h.repeat(width + 2) + S.tr);
  const bottom = color(S.bl + S.h.repeat(width + 2) + S.br);
  const mid = lines.map((l) => color(S.v) + ' ' + pad(l, width) + ' ' + color(S.v));
  return [top, ...mid, bottom].join('\n');
}
