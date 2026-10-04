import { db } from './db';

export interface ProgressEvent {
  stage: string;
  message: string;
  percent: number;
  metadata?: Record<string, unknown>;
}

export async function createProgress(id: string): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO vantage_progress (id, stage, message, percent, metadata, created_at)
    VALUES (${id}, 'starting', 'Starting glow-up…', 0, '{}', NOW())
  `;
}

export async function updateProgress(
  id: string,
  event: ProgressEvent
): Promise<void> {
  const sql = db();
  await sql`
    UPDATE vantage_progress
    SET stage = ${event.stage},
        message = ${event.message},
        percent = ${event.percent},
        metadata = ${JSON.stringify(event.metadata ?? {})},
        updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function getProgress(id: string): Promise<ProgressEvent | null> {
  const sql = db();
  const rows = await sql<Array<{ stage: string; message: string; percent: number; metadata: Record<string, unknown> }>>`
    SELECT stage, message, percent, metadata
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
