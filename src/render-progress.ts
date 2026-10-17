export interface RenderProgress { stage: string; done?: number; total?: number }

/** Reads HyperFrames 0.8.142's stage counters; its weighted pct is not a frame percentage. */
export function parseRenderProgress(line: string): RenderProgress | undefined {
  if (!line.startsWith('@hf-progress ')) return;
  try {
    const value = JSON.parse(line.slice(13));
    if (!value || typeof value.code !== 'string' || !/^[a-z_]+$/.test(value.code)) return;
    for (const key of ['done', 'total']) if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)) return;
    if (value.done !== undefined && value.total !== undefined && value.done > value.total) return;
    return { stage: value.code, ...(value.done !== undefined && { done: value.done }), ...(value.total !== undefined && { total: value.total }) };
  } catch { return; }
}

/** A stage ETA requires a stage-local clock; total render time includes unmeasured setup and encoding. */
export function formatRenderProgress(progress: RenderProgress, { elapsedMs, stageElapsedMs }: { elapsedMs: number; stageElapsedMs?: number }): string {
  const { stage, done, total } = progress;
  const unit = stage === 'capture' || stage === 'encode' ? 'frames' : stage === 'assemble' ? 'seconds' : stage === 'start_browsers' ? 'browsers' : 'items';
  const parts = [stage];
  if (done !== undefined) parts.push(`${done}${total === undefined ? '' : `/${total}`} ${unit}`);
  parts.push(`elapsed ${Math.round(Math.max(0, elapsedMs) / 1000)}s`);
  if (stageElapsedMs !== undefined && stageElapsedMs > 0 && done !== undefined && done > 0 && total !== undefined && total > done && ['capture', 'encode', 'assemble'].includes(stage)) parts.push(`stage ETA ${Math.ceil(stageElapsedMs / 1000 * (total - done) / done)}s`);
  return parts.join(' · ');
}
