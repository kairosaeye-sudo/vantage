import { db } from './db';

export interface ProgressEvent {
  stage: string;
  message: string;
  percent: number;
  metadata?: Record<string, unknown>;
}

export async function createProgress(id: string): Promise<void> {
  const sql = db();
  // Upsert so a retried request with the same client-generated id doesn't fail.
  await sql`
    INSERT INTO vantage_progress (id, stage, message, percent, metadata, created_at)
    VALUES (${id}, 'starting', 'Starting glow-up…', 0, '{}', NOW())
    ON CONFLICT (id) DO UPDATE
      SET stage = 'starting',
          message = 'Starting glow-up…',
          percent = 0,
          metadata = '{}',
          stage_history = '[]'::jsonb,
          updated_at = NOW()
  `;
}

export async function updateProgress(
  id: string,
  event: ProgressEvent
): Promise<void> {
  const sql = db();
  // Append to stage history so the UI can show all completed stages
  const entry = JSON.stringify({ stage: event.stage, message: event.message, percent: event.percent, at: new Date().toISOString() });
  await sql`
    UPDATE vantage_progress
    SET stage = ${event.stage},
        message = ${event.message},
        percent = ${event.percent},
        metadata = ${JSON.stringify(event.metadata ?? {})},
        updated_at = NOW(),
        stage_history = COALESCE(stage_history, '[]'::jsonb) || ${entry}::jsonb
    WHERE id = ${id}
  `;
}

export async function getProgress(id: string): Promise<ProgressEvent | null> {
  const sql = db();
  const rows = await sql<Array<{ stage: string; message: string; percent: number; metadata: Record<string, unknown>; stage_history: Array<{ stage: string; message: string; percent: number; at: string }> }>>`
    SELECT stage, message, percent, metadata, COALESCE(stage_history, '[]'::jsonb) AS stage_history
    FROM vantage_progress
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function deleteProgress(id: string): Promise<void> {
  const sql = db();
  await sql`DELETE FROM vantage_progress WHERE id = ${id}`;
}
