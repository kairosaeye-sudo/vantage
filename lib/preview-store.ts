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

export interface PreviewFix {
  findingId: string;
  label: string;
  category: string;
  points: number;
  /** True when the change lives in <head> and cannot be outlined in the page. */
  headOnly?: boolean;
}

/** A change made by the redesign engine. */
export interface RedesignChange {
  label: string;
  detail: string;
  kind: string;
}

/** Metadata for a redesign preview. */
export interface RedesignMeta {
  templateId: string;
  templateLabel: string;
  changes: RedesignChange[];
  omitted: Array<{ section: string; reason: string }>;
  needsFromClient: string[];
}

export interface PreviewStore {
  id: string;
  /** 'glowup' = technical fixes. 'redesign' = visual rebuild (legacy standalone runs). */
  kind: 'glowup' | 'redesign';
  before: string;
  /** The page after technical fixes (same design, gaps closed). */
  after: string;
  /** The page rebuilt through the modern design system. Null when not run. */
  redesigned: string | null;
  files: Record<string, string>;
  url: string;
  beforeScore: number;
  afterScore: number;
  fixes: PreviewFix[];
  redesign: RedesignMeta | null;
  /** True when a field was auto-detected for this glow-up. */
  fieldDetected: boolean;
  /** The field the site was matched against, so the preview compares against the right peer set. */
  fieldId: string | null;
  createdAt: string;
}

export async function savePreview(
  id: string,
  data: {
    kind?: 'glowup' | 'redesign';
    before: string;
    after: string;
    /** Optional third view: the redesigned page. */
    redesigned?: string | null;
    files: Record<string, string>;
    url: string;
    beforeScore: number;
    afterScore: number;
    fixes: PreviewFix[];
    redesign?: RedesignMeta | null;
    /** True when a field was auto-detected for this glow-up. */
    fieldDetected?: boolean;
    /** The field used, so the preview compares against the right peer set. */
    fieldId?: string | null;
  },
  watchId?: string
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO vantage_previews (id, kind, before_html, after_html, redesigned_html, files, url, before_score, after_score, fixes, redesign, field_detected, field_id)
    VALUES (
      ${id}, ${data.kind ?? 'glowup'}, ${data.before}, ${data.after}, ${data.redesigned ?? null},
      ${sql.json(data.files as never)},
      ${data.url}, ${data.beforeScore}, ${data.afterScore}, ${sql.json(data.fixes as never)},
      ${data.redesign ? sql.json(data.redesign as never) : null},
      ${data.fieldDetected ?? false},
      ${data.fieldId ?? null}
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
    SELECT id, COALESCE(kind, 'glowup') AS kind, before_html AS before, after_html AS after,
           redesigned_html AS redesigned, files, url,
           before_score AS "beforeScore", after_score AS "afterScore",
           fixes, redesign, COALESCE(field_detected, false) AS "fieldDetected",
           field_id AS "fieldId", created_at AS "createdAt"
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
