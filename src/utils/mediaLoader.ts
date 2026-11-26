import type { MediaAsset } from '../types/editor';

export interface LoadedMediaCache {
  images: Map<string, HTMLImageElement>;
  videos: Map<string, HTMLVideoElement>;
}

export const mediaCache: LoadedMediaCache = {
  images: new Map(),
  videos: new Map(),
};

let hiddenVideoPoolEl: HTMLDivElement | null = null;

/**
 * Keeps managed HTMLVideoElements mounted inside an active, compositor-visible (2x2px,
 * opacity 0.01) DOM host so mobile browsers (especially Android Chrome / WebView)
 * never evict or black out hardware decoder SurfaceTextures during playback.
 */
export function ensureVideoElementMounted(video: HTMLVideoElement): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (!hiddenVideoPoolEl || !hiddenVideoPoolEl.isConnected) {
    hiddenVideoPoolEl = document.getElementById('insho-video-pool') as HTMLDivElement | null;
    if (!hiddenVideoPoolEl) {
      hiddenVideoPoolEl = document.createElement('div');
      hiddenVideoPoolEl.id = 'insho-video-pool';
      hiddenVideoPoolEl.setAttribute('aria-hidden', 'true');
      hiddenVideoPoolEl.style.cssText =
        'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;overflow:hidden;';
      document.body.appendChild(hiddenVideoPoolEl);
    }
  }
  if (!video.isConnected || video.parentElement !== hiddenVideoPoolEl) {
    video.style.width = '2px';
    video.style.height = '2px';
    hiddenVideoPoolEl.appendChild(video);
  }
}

export const SAMPLE_MEDIA_SPECS: Array<{
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
  defaultDuration: number;
}> = [
  {
    id: 'sample-neon-street',
    name: 'Tokyo Rain Neon',
    src: '/src/assets/images/sample_neon_street_1795456445588.jpg',
    width: 1080,
    height: 1920,
    defaultDuration: 4,
  },
  {
    id: 'sample-studio-dancer',
    name: 'Violet Rim Studio',
    src: '/src/assets/images/sample_studio_portrait_1795456446927.jpg',
    width: 1080,
    height: 1920,
    defaultDuration: 4,
  },
  {
    id: 'sample-coastal-dusk',
    name: 'Magenta Coastline',
    src: '/src/assets/images/sample_coastal_dusk_1795456447443.jpg',
    width: 1920,
    height: 1080,
    defaultDuration: 4,
  },
];

export function loadImageElement(assetId: string, src: string): Promise<HTMLImageElement> {
  const existing = mediaCache.images.get(assetId);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      mediaCache.images.set(assetId, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

export function getOrCreateVideoElement(assetId: string, src: string): HTMLVideoElement {
  const existing = mediaCache.videos.get(assetId);
  if (existing) {
    ensureVideoElementMounted(existing);
    return existing;
  }
  const video = document.createElement('video');
  video.src = src;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.disableRemotePlayback = true;
  video.preload = 'auto';
  video.muted = true; // Audio is handled via Web Audio / controlled explicitly
  mediaCache.videos.set(assetId, video);
  ensureVideoElementMounted(video);
  return video;
}

export async function createSampleAssets(): Promise<MediaAsset[]> {
  const assets: MediaAsset[] = [];
  for (const spec of SAMPLE_MEDIA_SPECS) {
    let width = spec.width;
    let height = spec.height;
    try {
      const img = await loadImageElement(spec.id, spec.src);
      width = img.naturalWidth || spec.width;
      height = img.naturalHeight || spec.height;
    } catch {
      // Fallback to metadata dimensions if still loading
    }
    assets.push({
      id: spec.id,
      name: spec.name,
      kind: 'image',
      src: spec.src,
      duration: 10, // Source span for photo clips (trimmable up to 10s)
      width,
      height,
      thumbnails: [spec.src],
      isSample: true,
    });
  }
  return assets;
}

async function waitForDecodedThumbFrame(video: HTMLVideoElement, targetTime: number): Promise<void> {
  const safeTarget = Math.max(0, targetTime);
  if (
    !video.seeking &&
    video.readyState >= 2 &&
    video.videoWidth > 0 &&
    Math.abs(video.currentTime - safeTarget) <= 0.04
  ) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    let pollTimer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.clearInterval(pollTimer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onReady);
      resolve();
    };
    const onReady = () => {
      if (!video.seeking && video.readyState >= 2 && video.videoWidth > 0) {
        finish();
      }
    };
    const onSeeked = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        finish();
      } else if (!pollTimer) {
        pollTimer = window.setInterval(onReady, 16);
      }
    };
    const timeout = window.setTimeout(finish, 600);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('loadeddata', onReady);
    try {
      video.currentTime = safeTarget;
    } catch {
      finish();
      return;
    }
    if (!video.seeking && video.readyState >= 2 && video.videoWidth > 0) {
      finish();
    }
  });
}

async function extractVideoMetadataAndThumbnails(
  assetId: string,
  src: string,
): Promise<{ duration: number; width: number; height: number; thumbnails: string[] }> {
  const video = getOrCreateVideoElement(assetId, src);

  await new Promise<void>((resolve, reject) => {
    if (video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0) {
      resolve();
      return;
    }
    const onReady = () => {
      if (video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0) {
        if (video.readyState >= 2) {
          cleanup();
          resolve();
        }
      }
    };
    const onLoadedMeta = () => {
      if (video.readyState >= 2) {
        cleanup();
        resolve();
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not decode video metadata.'));
    };
    const fallbackTimer = window.setTimeout(() => {
      if (video.readyState >= 1) {
        cleanup();
        resolve();
      }
    }, 800);
    const cleanup = () => {
      window.clearTimeout(fallbackTimer);
      video.removeEventListener('loadedmetadata', onLoadedMeta);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadedmetadata', onLoadedMeta);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onError);
  });

  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 600);
      const finish = () => {
        if (Number.isFinite(video.duration) && video.duration > 0 && video.duration < 86400) {
          window.clearTimeout(timeout);
          video.removeEventListener('timeupdate', finish);
          video.removeEventListener('durationchange', finish);
          video.removeEventListener('seeked', finish);
          resolve();
        }
      };
      video.addEventListener('timeupdate', finish);
      video.addEventListener('durationchange', finish);
      video.addEventListener('seeked', finish);
      try {
        video.currentTime = 1e6;
      } catch {
        window.clearTimeout(timeout);
        resolve();
      }
    });
  }

  const duration = Math.max(
    0.5,
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5,
  );
  const width = video.videoWidth || 1080;
  const height = video.videoHeight || 1920;

  const thumbnails: string[] = [];
  const thumbCanvas = document.createElement('canvas');
  const thumbW = 120;
  const thumbH = Math.max(68, Math.round((thumbW * height) / Math.max(1, width)));
  thumbCanvas.width = thumbW;
  thumbCanvas.height = thumbH;
  const ctx = thumbCanvas.getContext('2d');

  if (ctx) {
    const count = 4;
    for (let i = 0; i < count; i++) {
      const targetTime = Math.min(Math.max(0, duration - 0.08), (duration * (i + 0.5)) / count);
      await waitForDecodedThumbFrame(video, targetTime);
      try {
        ctx.drawImage(video, 0, 0, thumbW, thumbH);
        thumbnails.push(thumbCanvas.toDataURL('image/jpeg', 0.65));
      } catch {
        // Ignore frame extraction error
      }
    }
  }

  // Rewind back to start frame so preview canvas draws frame 0 immediately after import
  await waitForDecodedThumbFrame(video, 0);

  return { duration, width, height, thumbnails };
}

export async function importMediaFile(file: File, id: string): Promise<MediaAsset> {
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) {
    throw new Error(`Unsupported media type: ${file.name}`);
  }

  const src = URL.createObjectURL(file);
  const cleanName = file.name.replace(/\.[^/.]+$/, '') || 'Imported Clip';

  if (isImage) {
    const img = await loadImageElement(id, src);
    return {
      id,
      name: cleanName,
      kind: 'image',
      src,
      duration: 10,
      width: img.naturalWidth || 1080,
      height: img.naturalHeight || 1920,
      thumbnails: [src],
    };
  }

  const meta = await extractVideoMetadataAndThumbnails(id, src);
  // Floor to 2 decimals so trimEnd never exceeds actual source stream duration
  const safeDuration = Math.max(0.5, Math.floor(meta.duration * 100) / 100);
  return {
    id,
    name: cleanName,
    kind: 'video',
    src,
    duration: safeDuration,
    width: meta.width,
    height: meta.height,
    thumbnails: meta.thumbnails,
  };
}
