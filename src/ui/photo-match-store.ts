import type { AngleObservation, Finish, MatchResult } from '../color/solve.ts';
import type { ViewAngle } from '../color/mixing.ts';

const DB_NAME = 'koncept-paint-photo-matches';
const DB_VERSION = 1;
const STORE_NAME = 'comparisons';
export const MAX_SAVED_PHOTO_MATCHES = 10;
export const MAX_SAVED_PHOTO_BYTES = 100_000_000;

export interface SavedPhotoAngle extends AngleObservation {
  fileName: string;
  fileBytes: number;
  blob: Blob;
  width: number;
  height: number;
  sample: [number, number, number] | null;
  point: [number, number] | null;
  referenceSample: [number, number, number] | null;
  referencePoint: [number, number] | null;
}

export interface SavedPhotoMatch {
  id: string;
  name: string;
  createdAt: number;
  bytes: number;
  reference: string | null;
  finish: Finish;
  result: MatchResult;
  views: AngleObservation[];
  photos: SavedPhotoAngle[];
}

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('This browser does not support local photo storage.'));
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local photo storage.'));
    request.onblocked = () => reject(new Error('Local photo storage is busy in another tab. Close other app tabs and try again.'));
  });
  database.catch(() => { database = null; });
  return database;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not read local photo storage.'));
  });
}

export async function listSavedPhotoMatches(): Promise<SavedPhotoMatch[]> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const values = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as SavedPhotoMatch[];
  return values.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addSavedPhotoMatch(record: SavedPhotoMatch): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const existing = await requestResult(store.getAll()) as SavedPhotoMatch[];
  const currentBytes = existing.reduce((sum, item) => sum + (Number.isFinite(item.bytes) ? item.bytes : 0), 0);
  if (existing.length >= MAX_SAVED_PHOTO_MATCHES) {
    transaction.abort();
    throw new Error(`You can save up to ${MAX_SAVED_PHOTO_MATCHES} comparisons. Remove one before saving another.`);
  }
  if (record.bytes > MAX_SAVED_PHOTO_BYTES || currentBytes + record.bytes > MAX_SAVED_PHOTO_BYTES) {
    transaction.abort();
    throw new Error('Saved comparisons have a 100 MB total limit. Remove a saved comparison to make room.');
  }
  await requestResult(store.add(record));
}

export async function updateSavedPhotoMatch(record: SavedPhotoMatch): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  await requestResult(transaction.objectStore(STORE_NAME).put(record));
}

export async function deleteSavedPhotoMatch(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  await requestResult(transaction.objectStore(STORE_NAME).delete(id));
}

export function isViewAngle(value: unknown): value is ViewAngle {
  return value === 'face' || value === 'mid' || value === 'grazing';
}
