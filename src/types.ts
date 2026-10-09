// The shapes of a schema-valid story.yaml and timing.json. The JSON schemas in schemas/ own these contracts and
// enforce them at runtime; change a schema first, then mirror it here.

export interface Copy {
  category?: string;
  headline: string;
  support?: string;
}

export interface Composition {
  id: string;
  copy: Copy;
  narration: string;
  hold?: number;
  overlap?: number;
}

export interface Scene {
  id: string;
  title: string;
  compositions: Composition[];
}

export interface Story {
  id: string;
  title: string;
  theme: string;
  canvas: { width: number; height: number; fps: number };
  pronunciations?: Record<string, string>;
  scenes: (Composition | Scene)[];
}

export interface SceneTiming {
  start: number;
  duration: number;
  beats: Record<string, number>;
}

export interface Timing {
  source: 'estimate' | 'aligned' | 'imported';
  audio?: string;
  audioDuration?: number;
  duration: number;
  scenes: Record<string, SceneTiming>;
}
