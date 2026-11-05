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
  card?: 'chapter' | 'agenda';
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
  pronunciations?: Record<string, Pronunciation>;
  voice?: StoryVoice;
  scenes: (Composition | Scene)[];
}

export interface SceneReference {
  source: string;
}

export type VisualSource = Omit<Composition, 'card'> & {
  source: string;
  card?: never;
};

export type CardSource = Composition & {
  card: 'chapter' | 'agenda';
  source?: never;
};

export interface SceneSource {
  id: string;
  title: string;
  compositions: Array<VisualSource | CardSource>;
}

export type FilmSource = Story | (Omit<Story, 'scenes'> & { scenes: SceneReference[] });

export interface CompositionSource {
  definition: string;
  html?: string;
}

export interface ResolvedFilm {
  story: Story;
  mode: 'inline' | 'referenced';
  sources: Map<string, CompositionSource>;
}

export type LoadStoryResult =
  | { value: Story; resolved: ResolvedFilm; errors: [] }
  | { value?: never; resolved?: never; errors: string[] };

export type Pronunciation = string | { text: string; lang: string };

export interface StoryVoice {
  name?: string;
  lang?: string;
  speed?: number;
  gap?: number;
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
