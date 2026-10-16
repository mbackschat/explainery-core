import type { parseHTML } from 'linkedom';
import { spokenWords } from './narration.ts';
import { storyCompositions, type SceneSelection } from './story.ts';
import type { SubtitleCue } from './subtitles.ts';
import { toMillisecond } from './time.ts';
import type { Story, Timing } from './types.ts';

/** Estimates readable script chunks between authored beat anchors; these are not voice-aligned subtitles. */
export function previewNarrationCues(story: Story, timing: Timing): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const compositions = storyCompositions(story);
  for (const [index, composition] of compositions.entries()) {
    const slot = timing.scenes[composition.id];
    const { words, markers } = spokenWords(composition.narration);
    const end = Math.min(slot.duration - (composition.hold ?? 0), (timing.scenes[compositions[index + 1]?.id]?.start ?? timing.duration) - slot.start);
    const anchors = [{ before: 0, time: 0 }, ...markers.map(marker => ({ before: marker.before, time: slot.beats[marker.beat] })), { before: words.length, time: end }];
    for (let i = 0; i < anchors.length - 1; i++) {
      const from = anchors[i];
      const to = anchors[i + 1];
      if (to.before === from.before) continue;
      if (to.time <= from.time) throw new Error(`narration preview: ${composition.id} has no time for words after anchor ${i}; review its beats and hold`);
      const step = (to.time - from.time) / (to.before - from.before);
      for (let first = from.before; first < to.before;) {
        let last = first + 1;
        while (last < to.before && !/[.!?]["'’”)]*$/.test(words[last - 1]) && words.slice(first, last + 1).join(' ').length <= 84 && (last + 1 - first) * step <= 6) last++;
        cues.push({
          start: toMillisecond(slot.start + from.time + (first - from.before) * step),
          end: toMillisecond(slot.start + from.time + (last - from.before) * step),
          text: words.slice(first, last).join(' ').replace(/\s+([.,;:!?])/g, '$1'),
        });
        first = last;
      }
    }
  }
  return cues;
}

/** Adds timed, text-only clips to a disposable preview; the authored film is never changed. */
export function addPreviewNarration(document: ReturnType<typeof parseHTML>['document'], story: Story, timing: Timing, selection: SceneSelection): void {
  const root = document.querySelector('[data-composition-id]:not([data-composition-src])');
  if (!root) throw new Error('narration preview requires a root composition');
  const style = document.createElement('style');
  const unit = story.canvas.height / 1080;
  style.textContent = `[data-preview-narration] { position:absolute; left:5%; bottom:1.3%; width:73%; height:${112 * unit}px; z-index:2147483647; pointer-events:none; }
[data-preview-narration] .preview-narration-cue { position:absolute; inset:0; width:100%; height:100%; padding:${6 * unit}px ${20 * unit}px; box-sizing:border-box; background:rgba(0,0,0,.9); color:#fff; font-family:var(--font-family, sans-serif); text-align:center; }
[data-preview-narration] .preview-narration-cue::before { content:"Draft narration · estimated timing"; display:block; font-size:${18 * unit}px; line-height:${22 * unit}px; color:#c8ced4; }
[data-preview-narration] p { margin:0; font-size:${32 * unit}px; line-height:${36 * unit}px; font-weight:400; }`;
  document.head.appendChild(style);
  const overlay = document.createElement('div');
  overlay.setAttribute('data-preview-narration', '');
  for (const [index, cue] of previewNarrationCues(story, timing).entries()) {
    const start = Math.max(cue.start, selection.start);
    const end = Math.min(cue.end, selection.end);
    if (end <= start) continue;
    const clip = document.createElement('p');
    clip.id = `explainery-preview-narration-${index}`;
    clip.className = 'clip preview-narration-cue';
    clip.setAttribute('data-start', String(toMillisecond(start - selection.start)));
    clip.setAttribute('data-duration', String(toMillisecond(end - start)));
    clip.textContent = cue.text;
    overlay.appendChild(clip);
  }
  root.appendChild(overlay);
}
