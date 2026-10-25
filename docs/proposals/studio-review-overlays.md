# Studio review overlays

Accepted for implementation on 25 October 2026. Extends the [fast-feedback workflow](../authoring.md#use-studio-for-fast-feedback) with retained presenter stills and reviewed subtitles, without creating media or changing delivery inputs.

## Required

`explainery preview <project-dir> [--presenters <plan.json>] [--subtitles <captions.vtt>]` supports either overlay or both, with existing focus, `--scene`, `--composition` and `--film` selection. Option paths resolve from the caller's working directory. Start, status and stop use the same selection and overlay options. Render rejects these preview options. `--subtitles` and estimated `--narration` are mutually exclusive; presenter stills may accompany either caption mode.

Subtitles use the existing [plain-text WebVTT contract](../adr/0007-html-playback-navigation.md), with film-clock times. Preview clips cues to the selected range and rebases them to its clock, preserving text and line breaks. A fixed lower-left caption band leaves the right-hand presenter area free; authors review any content collision. No automatic transcription or alignment occurs, and loading a file does not establish its editorial approval or association with the recording.

One presenter plan supplies one retained portrait and one fixed frame for the film. Its appearance windows reference composition IDs and composition-local seconds. Local timing keeps unrelated earlier scene edits from shifting the plan; changing the referenced composition's timing still requires review. Only windows belonging to selected compositions appear, intersected with the selected range. Appearance intervals are half-open, with immediate appearance/disappearance and no automatic fades.

```ts
interface PresenterPreviewPlan {
  portrait: string; // Existing PNG, JPEG or WebP path relative to the film project.
  frame: {
    x: number; y: number; width: number; height: number; // Canvas pixels.
    shape: 'circle' | 'rectangle';
    radius?: number; // Rectangle corner radius in pixels; default 0.
    zoom?: number; // Top-centred cover crop, default 1; values >= 1.
  };
  appearances: Array<{ composition: string; start: number; end: number }>;
}
```

Validate the entire plan before replacing a preview: reject unknown fields, missing/non-local portrait files, unsupported image types, unknown compositions, non-finite or out-of-range numbers, off-canvas frames, non-square circles, circle radii, empty appearance lists, overlapping film-clock appearances, and windows outside their composition. The portrait must resolve within the film project. Rectangle radius cannot exceed half its shorter edge. Cues and portraits must work after direct, forward and backward seeks, including disappearance in gaps and at interval ends.

Only disposable preview files receive overlays. Source compositions, story, timing, audio and retained media remain unchanged. Ordinary preview/render preparation removes previous review layers when the options are omitted; exports use authored sources. Existing narration and talking clips continue playing, so a portrait window must avoid an already-authored presenter if the author does not want both visible.

## Optional

Use either overlay independently. Use rounded rectangle framing through `radius`, or a closer portrait crop through `zoom`. The default caption band scales with the canvas.

## Excluded

Avatar/voice generation, provider calls, automatic regeneration, changes to story/timing schemas, presenter video replacement, editor controls, drag-and-drop placement, caption styling controls, new subtitle formats and MP4 rendering are outside this change. A still validates placement and timing, not lip synchronization or performance. Browser review does not replace final encoded-output verification.
