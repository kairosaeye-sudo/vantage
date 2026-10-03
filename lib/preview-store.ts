import { db } from './db';

/**
 * Storage for glow-up previews.
 *
 * The before/after HTML is too large to return through the JSON API, so the
 * run persists it and returns a short id. The preview page then streams each
 * version from /api/glowup/preview?id=...&side=before|after.
 *
 * When a watchId is present we also write the real `vantage_glowups` row, so a
 * preview is not a throwaway: it becomes part of the customer's history.
 */

export interface PreviewStore {
  before: string;
  after: string;
  files: Record<string, string>;
  url: string;
  beforeScore: number;
  afterScore: number;
  createdAt: string;
}

export async function savePreview(
  id: string,
  data: { before: string; after: string; files: Record<string, string>; url: string; beforeScore: number; afterScore: number },
  watchId?: string
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO vantage_previews (id, before_html, after_html, files, url, before_score, after_score)
    VALUES (
      ${id}, ${data.before}, ${data.after}, ${sql.json(data.files as never)},
      ${data.url}, ${data.beforeScore}, ${data.afterScore}
    )
    ON CONFLICT (id) DO NOTHING
  `;

  if (watchId) {
    await sql`
      UPDATE vantage_glowups SET artifacts = ${sql.json({ previewId: id, ...data.files } as never)}
      WHERE watch_id = ${watchId} AND url = ${data.url}
    `;
  }
}

export async function getPreview(id: string): Promise<PreviewStore | null> {
  const sql = db();
  const rows = await sql<PreviewStore[]>`
    SELECT before_html AS before, after_html AS after, files, url,
           before_score AS "beforeScore", after_score AS "afterScore",
           created_at AS "createdAt"
    FROM vantage_previews
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Drop previews older than the retention window so the table does not grow forever. */
export async function prunePreviews(days = 30): Promise<number> {
  const sql = db();
  const rows = await sql`
    DELETE FROM vantage_previews
    WHERE created_at < NOW() - ${sql.unsafe(`INTERVAL '${Math.max(1, Math.floor(days))} days'`)}
    RETURNING id
  `;
  return rows.length;
}
