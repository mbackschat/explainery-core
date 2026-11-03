export interface SourceCue {
  cue: number;
  sourceCue: string;
  sourceStart: string;
  sourceEnd: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

function seconds(timestamp: string): number {
  const [hours, minutes, remainder] = timestamp.split(':');
  const [wholeSeconds, milliseconds] = remainder.split(',');
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(wholeSeconds) + Number(milliseconds) / 1000;
}

export function parseSrt(text: string): SourceCue[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const cues: SourceCue[] = [];
  const identifiers = new Set<number>();
  const timestamp = '(\\d{2,}:[0-5]\\d:[0-5]\\d,\\d{3})';
  const timingPattern = new RegExp(`^[ \\t]*${timestamp}[ \\t]+-->[ \\t]+${timestamp}[ \\t]*$`);
  let index = 0;
  while (index < lines.length) {
    if (lines[index].trim() === '') {
      index++;
      continue;
    }
    const identifier = lines[index++].trim();
    const cue = Number(identifier);
    if (!/^\d+$/.test(identifier) || !Number.isSafeInteger(cue) || cue < 1) {
      throw new Error(`Invalid cue identifier at line ${index}: ${identifier}`);
    }
    if (identifiers.has(cue)) throw new Error(`Duplicate cue identifier: ${cue}`);
    const timing = timingPattern.exec(lines[index++] ?? '');
    if (!timing) throw new Error(`Invalid timing for cue ${cue}`);
    const [, sourceStart, sourceEnd] = timing;
    const startSeconds = seconds(sourceStart);
    const endSeconds = seconds(sourceEnd);
    if (!Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
      throw new Error(`Nonpositive or invalid duration for cue ${cue}`);
    }
    const body: string[] = [];
    while (index < lines.length && lines[index].trim() !== '') body.push(lines[index++]);
    cues.push({ cue, sourceCue: identifier, sourceStart, sourceEnd, startSeconds, endSeconds, text: body.join('\n') });
    identifiers.add(cue);
  }
  return cues;
}
