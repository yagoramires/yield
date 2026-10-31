import type { Insight } from '../ai/insights'
import type { Month } from '../domain/types'
import type { Db } from './client'

export interface SavedInsights { month: Month; factsHash: string; model: string; insights: Insight[]; createdAt: string }

export async function getInsights(db: Db, month: Month): Promise<SavedInsights | null> {
  const [r] = await db.select<{ month: Month; factsHash: string; model: string; json: string; createdAt: string }>(
    'SELECT month, facts_hash AS factsHash, model, json, created_at AS createdAt FROM ai_insights WHERE month = ?', [month])
  return r ? { month: r.month, factsHash: r.factsHash, model: r.model, insights: JSON.parse(r.json), createdAt: r.createdAt } : null
}

export async function saveInsights(db: Db, s: SavedInsights): Promise<void> {
  await db.execute(
    `INSERT INTO ai_insights (month, facts_hash, model, json, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (month) DO UPDATE SET facts_hash = excluded.facts_hash, model = excluded.model, json = excluded.json, created_at = excluded.created_at`,
    [s.month, s.factsHash, s.model, JSON.stringify(s.insights), s.createdAt])
}
