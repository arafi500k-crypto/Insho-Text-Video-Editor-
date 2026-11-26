export type MediaKind = 'video' | 'image';

export type AspectRatioPreset = '9:16' | '16:9' | '1:1' | '4:5';

export type ExportResolution = '480p' | '720p' | '1080p';

export type EditorTool =
  | 'media'
  | 'edit'
  | 'overlay'
  | 'text'
  | 'filter'
  | 'audio'
  | 'transition';

export type FilterPresetId =
  | 'original'
  | 'vivid'
  | 'noir'
  | 'cyber-pink'
  | 'amethyst'
  | 'warm-film'
  | 'cool-crisp'
  | 'vintage';

export type TransitionType =
  | 'none'
  | 'dissolve'
  | 'fade-black'
  | 'slide-left'
  | 'zoom-in';

export type CropFitMode = 'cover' | 'contain';

export type TextBoxStyle =
  | 'none'
  | 'obsidian'
  | 'white-pill'
  | 'pink-purple'
  | 'outline';

export type TextAnimation = 'none' | 'fade' | 'pop' | 'slide-up' | 'spin-360';

export type TextFontFamily =
  | 'Plus Jakarta Sans'
  | 'Outfit'
  | 'Oswald'
  | 'Playfair Display'
  | 'JetBrains Mono';

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  src: string;
  duration: number; // seconds; images default to 4s source range (expandable)
  width: number;
  height: number;
  thumbnails: string[];
  isSample?: boolean;
}

export interface ClipFilter {
  preset: FilterPresetId;
  brightness: number; // 50..150 (100 = normal)
  contrast: number; // 50..150 (100 = normal)
  saturation: number; // 0..200 (100 = normal)
  warmth: number; // 0..100 (0 = normal sepia amount)
  blur: number; // 0..10 px
}

export interface ClipCrop {
  fit: CropFitMode;
  zoom: number; // 1.0..2.5
  panX: number; // -0.5..0.5
  panY: number; // -0.5..0.5
}

export interface TimelineClip {
  id: string;
  assetId: string;
  label: string;
  kind: MediaKind;
  sourceDuration: number;
  trimStart: number; // seconds inside source
  trimEnd: number; // seconds inside source
  speed: number; // 0.25..4
  volume: number; // 0..1
  muted: boolean;
  filter: ClipFilter;
  crop: ClipCrop;
  transitionIn: TransitionType;
  transitionDuration: number; // seconds (0.2..1.2)
}

export interface TextOverlay {
  id: string;
  text: string;
  startTime: number;
  duration: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  rotation: number; // degrees 0..360
  fontFamily: TextFontFamily;
  fontSize: number; // relative base px on 1080 height canvas (28..120)
  color: string;
  boxStyle: TextBoxStyle;
  align: 'left' | 'center' | 'right';
  opacity: number; // 0.1..1
  animation: TextAnimation;
  spinSpeed?: number; // 0.5..3 (1 = 180 deg/s, full 360 every 2s)
  spinDirection?: 'cw' | 'ccw';
}

export interface MediaOverlayChromaKey {
  enabled: boolean;
  color: string; // '#rrggbb'
  similarity: number; // 0..100 (Intensity)
  smoothness: number; // 0..100 (Feather edge)
  shadow?: number; // 0..100 (Shadow cleanup)
  edgeCleanup?: number; // 0..100 (Clean up edge)
  pickerX: number; // normalized 0..1 inside overlay
  pickerY: number; // normalized 0..1 inside overlay
}

export interface MediaOverlay {
  id: string;
  assetId: string;
  label: string;
  kind: MediaKind;
  sourceDuration: number;
  startTime: number;
  duration: number;
  x: number; // normalized 0..1 on main canvas
  y: number; // normalized 0..1 on main canvas
  scale: number; // 0.15..1.6 fraction of canvas short side
  rotation: number; // degrees 0..360
  opacity: number; // 0.1..1
  spinEnabled: boolean;
  spinSpeed?: number; // 0.5..3
  spinDirection?: 'cw' | 'ccw';
  chromaKey: MediaOverlayChromaKey;
}

export interface AudioTrackItem {
  id: string;
  name: string;
  src: string;
  duration: number;
  volume: number; // 0..1
  muted: boolean;
  startTime: number; // timeline offset in seconds
  isBuiltIn?: boolean;
}

export interface TimelineSegment {
  clip: TimelineClip;
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface ProjectDraft {
  id: string;
  title: string;
  code: string;
  updatedAt: number;
  aspectRatio: AspectRatioPreset;
  totalDuration: number;
  clipCount: number;
  thumbnail?: string;
  clips: TimelineClip[];
  overlays: TextOverlay[];
  mediaOverlays?: MediaOverlay[];
  audioTracks: AudioTrackItem[];
  assetIds: string[];
}
