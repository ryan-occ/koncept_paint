/**
 * Shared paint library: paints saved here are offered to Koncept Kits, which reads them
 * through GET /api/library/export with the PAINT_LIBRARY_KEY secret.
 * Stored in Postgres when DATABASE_URL is set, otherwise in memory (lost on restart).
 */

const HEX = /^#[\da-f]{6}$/i;

export const LIBRARY_LIMITS = Object.freeze({
  name: 80,
  shiftLabel: 40,
  finish: 300,
  recipeChars: 4000,
  batch: 100,
});

export class LibraryInputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value) => (value === undefined || value === null || value === '' ? null : value);

/** Validate one paint from the browser and return the stored shape. Throws LibraryInputError. */
export function validateLibraryPaint(raw) {
  if (!isRecord(raw)) throw new LibraryInputError('Each paint must be an object.');

  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > LIBRARY_LIMITS.name) {
    throw new LibraryInputError(`Paint names must be 1 to ${LIBRARY_LIMITS.name} characters.`);
  }
  if (typeof raw.hex !== 'string' || !HEX.test(raw.hex)) {
    throw new LibraryInputError(`${name}: the main colour must be a #RRGGBB hex code.`);
  }

  const hex2 = optionalText(raw.hex2);
  if (hex2 !== null && (typeof hex2 !== 'string' || !HEX.test(hex2))) {
    throw new LibraryInputError(`${name}: the second colour must be a #RRGGBB hex code.`);
  }
  const shiftLabel = optionalText(raw.shiftLabel);
  if (shiftLabel !== null &&
      (typeof shiftLabel !== 'string' || shiftLabel.trim().length > LIBRARY_LIMITS.shiftLabel)) {
    throw new LibraryInputError(`${name}: the colour-shift label must be at most ${LIBRARY_LIMITS.shiftLabel} characters.`);
  }
  if (shiftLabel !== null && hex2 === null) {
    throw new LibraryInputError(`${name}: a colour-shift label needs a second colour.`);
  }

  const finish = raw.finish === undefined ? '' : raw.finish;
  if (typeof finish !== 'string' || finish.length > LIBRARY_LIMITS.finish) {
    throw new LibraryInputError(`${name}: the finish description must be at most ${LIBRARY_LIMITS.finish} characters.`);
  }

  if (!isRecord(raw.recipe) || JSON.stringify(raw.recipe).length > LIBRARY_LIMITS.recipeChars) {
    throw new LibraryInputError(`${name}: the recipe is missing or too large.`);
  }

  const source = raw.source === undefined ? 'custom' : raw.source;
  if (source !== 'custom' && source !== 'preset') {
    throw new LibraryInputError(`${name}: source must be "custom" or "preset".`);
  }

  return {
    name,
    hex: raw.hex.toLowerCase(),
    hex2: hex2 === null ? null : hex2.toLowerCase(),
    shiftLabel: shiftLabel === null ? null : shiftLabel.trim(),
    finish: finish.trim(),
    recipe: structuredClone(raw.recipe),
    source,
  };
}

/** Validate a save request body: { paints: [...] }. */
export function validateLibraryBatch(body) {
  if (!isRecord(body) || !Array.isArray(body.paints) || body.paints.length === 0) {
    throw new LibraryInputError('Send at least one paint.');
  }
  if (body.paints.length > LIBRARY_LIMITS.batch) {
    throw new LibraryInputError(`Save at most ${LIBRARY_LIMITS.batch} paints at once.`);
  }
  const paints = body.paints.map(validateLibraryPaint);
  const names = paints.map((paint) => paint.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    throw new LibraryInputError('Two paints in this save have the same name.');
  }
  return paints;
}

/** What Koncept Kits receives: no recipe, only what a render needs. */
const shared = ({ id, name, hex, hex2, shiftLabel, finish, updatedAt }) => ({
  id, name, hex, ...(hex2 ? { hex2 } : {}), ...(shiftLabel ? { shiftLabel } : {}), finish, updatedAt,
});

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS paint_library (
  id serial PRIMARY KEY,
  name text NOT NULL,
  hex text NOT NULL,
  hex2 text,
  shift_label text,
  finish text NOT NULL DEFAULT '',
  recipe jsonb NOT NULL,
  source text NOT NULL DEFAULT 'custom',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS paint_library_name_idx ON paint_library (lower(name));
`;

const fromRow = (row) => ({
  id: row.id,
  name: row.name,
  hex: row.hex,
  hex2: row.hex2,
  shiftLabel: row.shift_label,
  finish: row.finish,
  recipe: row.recipe,
  source: row.source,
  updatedAt: new Date(row.updated_at).toISOString(),
});

function postgresStore(pool) {
  const list = async () => {
    const { rows } = await pool.query('SELECT * FROM paint_library ORDER BY lower(name)');
    return rows.map(fromRow);
  };
  return {
    kind: 'postgres',
    init: async () => { await pool.query(SCHEMA); },
    list,
    listShared: async () => (await list()).map(shared),
    async upsert(paints) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const p of paints) {
          await client.query(
            `INSERT INTO paint_library (name, hex, hex2, shift_label, finish, recipe, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT ((lower(name))) DO UPDATE SET
               name = EXCLUDED.name, hex = EXCLUDED.hex, hex2 = EXCLUDED.hex2,
               shift_label = EXCLUDED.shift_label, finish = EXCLUDED.finish,
               recipe = EXCLUDED.recipe, source = EXCLUDED.source, updated_at = now()`,
            [p.name, p.hex, p.hex2, p.shiftLabel, p.finish, JSON.stringify(p.recipe), p.source],
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* keep the original error */ }
        throw error;
      } finally {
        client.release();
      }
    },
    async remove(id) {
      const { rowCount } = await pool.query('DELETE FROM paint_library WHERE id = $1', [id]);
      return rowCount > 0;
    },
  };
}

function memoryStore() {
  const paints = new Map();
  let nextId = 1;
  const list = async () => [...paints.values()].map((p) => structuredClone(p)).sort(byName);
  return {
    kind: 'memory',
    init: async () => {},
    list,
    listShared: async () => (await list()).map(shared),
    async upsert(batch) {
      const now = new Date().toISOString();
      for (const p of batch) {
        const key = p.name.toLowerCase();
        const existing = paints.get(key);
        paints.set(key, { ...structuredClone(p), id: existing?.id ?? nextId++, updatedAt: now });
      }
    },
    async remove(id) {
      for (const [key, p] of paints) {
        if (p.id === id) { paints.delete(key); return true; }
      }
      return false;
    },
  };
}

export function createLibraryStore(pool) {
  return pool ? postgresStore(pool) : memoryStore();
}
