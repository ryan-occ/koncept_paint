import { medianRgb, srgbHex } from '../color/photo.ts';
import type { RGB } from '../types.ts';
import { $ } from './store.ts';
import { matchCustomColour } from './search.ts';

const MAX_PHOTOS = 6;
const MAX_FILE_BYTES = 20_000_000;
const MAX_TOTAL_BYTES = 50_000_000;
const MAX_IMAGE_EDGE = 1600;

interface AnglePhoto {
  image: HTMLImageElement;
  width: number;
  height: number;
  fileBytes: number;
  fileName: string;
  label: string;
  sample: RGB | null;
  point: [number, number] | null;
}

let photos: AnglePhoto[] = [];
let loading = false;
let notice = '';

function clearMatch() {
  $('matchOut').replaceChildren();
}

function updateStatus() {
  const sampled = photos.filter((photo) => photo.sample).length;
  const guidance = photos.length === 0
    ? 'Choose one to six photos. They stay in this browser and are not sent to a server. Photo results are estimates, not factory formulas.'
    : loading
      ? `Loading ${photos.length} photo${photos.length === 1 ? '' : 's'}…`
      : sampled < photos.length
        ? `Tap the painted area in each photo (${sampled} of ${photos.length} sampled). Avoid bright reflections.`
        : `${sampled} view${sampled === 1 ? '' : 's'} ready. The sampled colours will be combined into one estimate.`;
  $('photoMatchStatus').textContent = [notice, guidance].filter(Boolean).join(' ');
  $<HTMLButtonElement>('photoMatchBtn').disabled =
    loading || photos.length === 0 || sampled !== photos.length;
}

function drawPhoto(canvas: HTMLCanvasElement, photo: AnglePhoto) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.drawImage(photo.image, 0, 0, photo.width, photo.height);
  if (!photo.point) return;
  const [x, y] = photo.point;
  const radius = Math.max(6, Math.min(photo.width, photo.height) / 45);
  context.lineWidth = Math.max(2, radius / 7);
  context.strokeStyle = '#000';
  context.beginPath();
  context.arc(x, y, radius + 2, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = '#f2b705';
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.stroke();
}

function samplePhoto(photo: AnglePhoto, canvas: HTMLCanvasElement, point: Pick<MouseEvent, 'clientX' | 'clientY'>) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(photo.width - 1, Math.floor((point.clientX - rect.left) * photo.width / rect.width)));
  const y = Math.max(0, Math.min(photo.height - 1, Math.floor((point.clientY - rect.top) * photo.height / rect.height)));
  const radius = Math.max(2, Math.min(8, Math.round(Math.min(photo.width, photo.height) / 100)));
  const left = Math.max(0, x - radius);
  const top = Math.max(0, y - radius);
  const width = Math.min(photo.width - left, radius * 2 + 1);
  const height = Math.min(photo.height - top, radius * 2 + 1);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.drawImage(photo.image, 0, 0, photo.width, photo.height);
  const pixels = context.getImageData(left, top, width, height).data;
  const samples: RGB[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0) samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }
  if (!samples.length) return;
  photo.sample = medianRgb(samples);
  photo.point = [x, y];
  clearMatch();
  notice = '';
  renderPhotos();
  updateStatus();
}

function renderPhotos() {
  const list = $('photoAngles');
  list.replaceChildren();
  photos.forEach((photo, index) => {
    const card = document.createElement('article');
    card.className = 'photo-angle';
    const heading = document.createElement('div');
    heading.className = 'photo-angle-head';
    const label = document.createElement('input');
    label.type = 'text';
    label.maxLength = 40;
    label.value = photo.label;
    label.setAttribute('aria-label', `Label for photo angle ${index + 1}`);
    label.addEventListener('input', () => { photo.label = label.value; });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'chip';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove photo angle ${index + 1}`);
    remove.addEventListener('click', () => {
      photos.splice(index, 1);
      clearMatch();
      notice = '';
      renderPhotos();
      updateStatus();
    });
    heading.append(label, remove);

    const canvas = document.createElement('canvas');
    canvas.width = photo.width;
    canvas.height = photo.height;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'button');
    canvas.setAttribute('aria-label', `Photo angle ${index + 1}; click to sample a spot, or press Enter to sample the centre`);
    canvas.addEventListener('click', (event) => samplePhoto(photo, canvas, event));
    canvas.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      samplePhoto(photo, canvas, {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      });
    });
    drawPhoto(canvas, photo);

    const detail = document.createElement('p');
    detail.className = 'photo-angle-detail';
    detail.textContent = photo.sample
      ? `Sampled ${srgbHex(photo.sample).toUpperCase()}`
      : `Tap to sample · ${photo.fileName}`;
    card.append(heading, canvas, detail);
    list.append(card);
  });
}

function loadImage(file: File): Promise<AnglePhoto> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      resolve({
        image,
        width: Math.max(1, Math.round(image.naturalWidth * scale)),
        height: Math.max(1, Math.round(image.naturalHeight * scale)),
        fileBytes: file.size,
        fileName: file.name,
        label: `Angle ${photos.length + 1}`,
        sample: null,
        point: null,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}.`));
    };
    image.src = url;
  });
}

async function addPhotos(files: FileList | null) {
  const selected = Array.from(files ?? []);
  if (!selected.length) return;
  const room = MAX_PHOTOS - photos.length;
  const accepted: File[] = [];
  let totalBytes = photos.reduce((sum, photo) => sum + photo.fileBytes, 0);
  notice = '';
  if (room <= 0) {
    notice = `You can use up to ${MAX_PHOTOS} photos; remove one before adding more.`;
    updateStatus();
    return;
  }
  for (const file of selected) {
    if (!file.type.startsWith('image/')) {
      notice = 'Only image files are supported.';
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      notice = 'Each photo must be smaller than 20 MB.';
      continue;
    }
    if (accepted.length >= room) {
      notice = `Only the first ${MAX_PHOTOS} angle photos can be used.`;
      break;
    }
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      notice = 'The selected photos exceed the 50 MB total limit.';
      break;
    }
    totalBytes += file.size;
    accepted.push(file);
  }
  if (!accepted.length) {
    updateStatus();
    return;
  }

  loading = true;
  clearMatch();
  updateStatus();
  const loaded = await Promise.all(accepted.map(async (file) => {
    try { return await loadImage(file); } catch (error) {
      notice = error instanceof Error ? error.message : 'A photo could not be read.';
      return null;
    }
  }));
  photos = [...photos, ...loaded.filter((photo): photo is AnglePhoto => photo !== null)];
  loading = false;
  renderPhotos();
  updateStatus();
}

function runMatch() {
  if (loading || photos.length === 0 || photos.some((photo) => !photo.sample)) return;
  const target = medianRgb(photos.map((photo) => photo.sample!));
  const hex = srgbHex(target);
  const label = `Photo estimate · ${photos.length} view${photos.length === 1 ? '' : 's'}`;
  notice = `Matching ${photos.length} sampled view${photos.length === 1 ? '' : 's'} (${hex.toUpperCase()}).`;
  updateStatus();
  matchCustomColour(hex, label);
}

export function initPhotoMatch() {
  const input = $<HTMLInputElement>('photoMatchFiles');
  input.addEventListener('change', () => {
    const files = input.files;
    void addPhotos(files);
    input.value = '';
  });
  $('photoMatchBtn').addEventListener('click', runMatch);
  updateStatus();
}
