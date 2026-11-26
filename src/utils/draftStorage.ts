import type { MediaAsset, MediaKind, ProjectDraft } from '../types/editor';
import { getOrCreateVideoElement, loadImageElement } from './mediaLoader';

const DB_NAME = 'insho-text-studio-db';
const DB_VERSION = 1;
const STORE_DRAFTS = 'drafts';
const STORE_ASSETS = 'assets';

export interface StoredAssetRecord {
  id: string;
  name: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  thumbnails: string[];
  blob?: Blob;
  src?: string;
  isSample?: boolean;
}

function openDraftDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
          db.createObjectStore(STORE_DRAFTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveStoredAsset(
  asset: MediaAsset,
  blob?: Blob,
): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  const record: StoredAssetRecord = {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
    thumbnails: asset.thumbnails,
    blob,
    src: blob ? undefined : asset.src,
    isSample: asset.isSample,
  };
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_ASSETS, 'readwrite');
      tx.objectStore(STORE_ASSETS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function saveProjectDraftRecord(draft: ProjectDraft): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_DRAFTS, 'readwrite');
      tx.objectStore(STORE_DRAFTS).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteProjectDraftRecord(draftId: string): Promise<void> {
  const db = await openDraftDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_DRAFTS, 'readwrite');
      tx.objectStore(STORE_DRAFTS).delete(draftId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadAllProjectDrafts(): Promise<ProjectDraft[]> {
  const db = await openDraftDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_DRAFTS, 'readonly');
      const req = tx.objectStore(STORE_DRAFTS).getAll();
      req.onsuccess = () => {
        const rows = (req.result as ProjectDraft[]) || [];
        resolve(rows.sort((a, b) => b.updatedAt - a.updatedAt));
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function hydrateDraftAssets(
  assetIds: string[],
  existingAssetsById: Map<string, MediaAsset>,
): Promise<MediaAsset[]> {
  const missingIds = assetIds.filter((id) => !existingAssetsById.has(id));
  if (missingIds.length === 0) return [];

  const db = await openDraftDb();
  if (!db) return [];

  const hydrated: MediaAsset[] = [];
  for (const id of missingIds) {
    const rec = await new Promise<StoredAssetRecord | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_ASSETS, 'readonly');
        const req = tx.objectStore(STORE_ASSETS).get(id);
        req.onsuccess = () => resolve((req.result as StoredAssetRecord) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (!rec) continue;

    const src = rec.blob ? URL.createObjectURL(rec.blob) : rec.src;
    if (!src) continue;

    if (rec.kind === 'image') {
      try {
        await loadImageElement(rec.id, src);
      } catch {
        // ignore broken image hydration
      }
    } else {
      getOrCreateVideoElement(rec.id, src);
    }

    const thumbnails = rec.thumbnails.map((t) => (t.startsWith('blob:') ? src : t));
    hydrated.push({
      id: rec.id,
      name: rec.name,
      kind: rec.kind,
      src,
      duration: rec.duration,
      width: rec.width,
      height: rec.height,
      thumbnails: thumbnails.length > 0 ? thumbnails : [src],
      isSample: rec.isSample,
    });
  }

  return hydrated;
}
