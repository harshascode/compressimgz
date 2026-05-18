import { decode, encode } from '@jsquash/jpeg';

type Status = 'pending' | 'processing' | 'done' | 'error';

type FileItem = {
  id: string;
  file: File;
  originalUrl: string;
  originalImageData?: ImageData;
  compressedBlob?: Blob;
  compressedUrl?: string;
  quality: number;
  status: Status;
  card: HTMLLIElement;
};

const MAX_FILES = 20;
const DEFAULT_QUALITY = 80;
const MIME_TYPE = 'image/jpeg';

const fileInput = mustGet<HTMLInputElement>('ui-fileInput');
const clearBtn = mustGet<HTMLButtonElement>('ui-clearBtn');
const convertBtn = mustGet<HTMLButtonElement>('ui-convertBtn');
const downloadAllBtn = mustGet<HTMLButtonElement>('ui-downloadAllBtn');
const convertCounter = mustGet<HTMLSpanElement>('ui-convertCounter');
const downloadCounter = mustGet<HTMLSpanElement>('ui-downloadCounter');
const dropZone = mustGet<HTMLDivElement>('ui-dropZone');
const dropMessage = mustGet<HTMLDivElement>('ui-dropMessage');
const filesScroll = mustGet<HTMLDivElement>('ui-filesScroll');
const filesContainer = mustGet<HTMLUListElement>('ui-filesContainer');
const prevBtn = mustGet<HTMLButtonElement>('ui-prevBtn');
const nextBtn = mustGet<HTMLButtonElement>('ui-nextBtn');
const template = mustGet<HTMLTemplateElement>('ui-fileCardTemplate');

const comparisonPanel = mustGet<HTMLElement>('ui-comparisonPanel');
const settingsFileName = mustGet<HTMLSpanElement>('ui-settingsFileName');
const originalSizeEl = mustGet<HTMLSpanElement>('ui-originalSize');
const compressedSizeEl = mustGet<HTMLSpanElement>('ui-compressedSize');
const savingsPercentEl = mustGet<HTMLSpanElement>('ui-savingsPercent');
const canvas = mustGet<HTMLCanvasElement>('ui-comparisonCanvas');
const thumb = mustGet<HTMLSpanElement>('ui-comparisonThumb');
const qualityInput = mustGet<HTMLInputElement>('ui-qualityInput');
const qualitySlider = mustGet<HTMLInputElement>('ui-qualitySlider');
const applyQualityBtn = mustGet<HTMLButtonElement>('ui-applyQualityBtn');
const settingsLoader = mustGet<HTMLSpanElement>('ui-settingsLoader');
const zoomIndicator = mustGet<HTMLButtonElement>('ui-zoomIndicator');

let items: FileItem[] = [];
let selectedId: string | null = null;
let split = 0.5;
let draggingSplit = false;
let processing = false;

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function outputName(name: string): string {
  return name.replace(/\.(jpe?g)$/i, '') + '-compressed.jpg';
}

function isJpeg(file: File): boolean {
  return file.type === MIME_TYPE || /\.jpe?g$/i.test(file.name);
}

function clampQuality(value: string | number): number {
  const numberValue = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (Number.isNaN(numberValue)) return DEFAULT_QUALITY;
  return Math.min(100, Math.max(10, numberValue));
}

function addFiles(fileList: FileList | File[]): void {
  const room = MAX_FILES - items.length;
  const accepted = Array.from(fileList).filter(isJpeg).slice(0, room);

  for (const file of accepted) {
    const id = crypto.randomUUID();
    const card = createCard(id, file);
    const item: FileItem = {
      id,
      file,
      originalUrl: URL.createObjectURL(file),
      quality: DEFAULT_QUALITY,
      status: 'pending',
      card,
    };
    items.push(item);
    filesContainer.append(card);
    setCardState(item, 'pending');
  }

  if (!selectedId && items[0]) selectItem(items[0].id);
  updateUi();
}

function createCard(id: string, file: File): HTMLLIElement {
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const card = fragment.querySelector<HTMLLIElement>('.ui-file');
  if (!card) throw new Error('Invalid file card template');
  card.dataset.id = id;
  card.querySelector<HTMLElement>('.ui-file-title')!.textContent = file.name;
  card.querySelector<HTMLImageElement>('.ui-file-image')!.src = URL.createObjectURL(file);
  card.querySelector<HTMLElement>('.ui-file-state-text-format')!.textContent = 'JPG';
  card.querySelector<HTMLButtonElement>('.ui-remove-btn')!.addEventListener('click', (event) => {
    event.stopPropagation();
    removeItem(id);
  });
  card.querySelector<HTMLButtonElement>('.ui-file-button')!.addEventListener('click', (event) => {
    event.stopPropagation();
    const item = findItem(id);
    if (item?.compressedBlob) downloadItem(item);
  });
  card.addEventListener('click', () => selectItem(id));
  return card;
}

function setCardState(item: FileItem, status: Status, detail = ''): void {
  item.status = status;
  const card = item.card;
  card.querySelectorAll('.ui-file-state').forEach((node) => node.classList.remove('ui-file-state-visible', 'file__state_visible'));
  const image = card.querySelector<HTMLImageElement>('.ui-file-image')!;
  const button = card.querySelector<HTMLButtonElement>('.ui-file-button')!;
  const buttonText = card.querySelector<HTMLSpanElement>('.ui-file-button-text')!;

  button.classList.add('ui-file-button-hidden');
  button.disabled = true;
  image.classList.remove('ui-file-image-hidden');

  if (status === 'pending') {
    card.querySelector('.ui-file-state-pending')!.classList.add('ui-file-state-visible');
  } else if (status === 'processing') {
    card.querySelector('.ui-file-state-converting')!.classList.add('ui-file-state-visible');
  } else if (status === 'error') {
    const errorState = card.querySelector<HTMLElement>('.ui-file-state-error')!;
    errorState.classList.add('ui-file-state-visible', 'file__state_visible');
    errorState.querySelector<HTMLElement>('.ui-file-state-detail')!.textContent = detail;
  } else {
    button.classList.remove('ui-file-button-hidden');
    button.disabled = false;
    buttonText.textContent = `${formatBytes(item.compressedBlob?.size ?? 0)} - SAVE`;
  }
}

function findItem(id: string | null): FileItem | undefined {
  return items.find((item) => item.id === id);
}

function removeItem(id: string): void {
  const item = findItem(id);
  if (!item) return;
  URL.revokeObjectURL(item.originalUrl);
  if (item.compressedUrl) URL.revokeObjectURL(item.compressedUrl);
  const imgUrl = item.card.querySelector<HTMLImageElement>('.ui-file-image')?.src;
  if (imgUrl) URL.revokeObjectURL(imgUrl);
  item.card.remove();
  items = items.filter((candidate) => candidate.id !== id);
  if (selectedId === id) selectItem(items[0]?.id ?? null);
  updateUi();
}

function clearAll(): void {
  for (const item of [...items]) removeItem(item.id);
  fileInput.value = '';
}

async function compressItem(item: FileItem, quality = item.quality): Promise<void> {
  setCardState(item, 'processing');
  try {
    const imageData = item.originalImageData ?? await decode(await item.file.arrayBuffer(), { preserveOrientation: true });
    item.originalImageData = imageData;
    const buffer = await encode(imageData, {
      quality,
      progressive: true,
      optimize_coding: true,
      trellis_multipass: true,
      trellis_opt_zero: true,
      trellis_opt_table: true,
      auto_subsample: true,
    });
    if (item.compressedUrl) URL.revokeObjectURL(item.compressedUrl);
    item.quality = quality;
    item.compressedBlob = new Blob([buffer], { type: MIME_TYPE });
    item.compressedUrl = URL.createObjectURL(item.compressedBlob);
    setCardState(item, 'done');
  } catch (error) {
    setCardState(item, 'error', error instanceof Error ? error.message : 'Could not compress this file.');
  }
}

async function compressAll(): Promise<void> {
  if (processing) return;
  processing = true;
  updateUi();
  for (const item of items) {
    await compressItem(item, item.quality);
    if (selectedId === item.id) await renderSelected();
    updateUi();
  }
  processing = false;
  updateUi();
}

function downloadItem(item: FileItem): void {
  if (!item.compressedUrl) return;
  const link = document.createElement('a');
  link.href = item.compressedUrl;
  link.download = outputName(item.file.name);
  document.body.append(link);
  link.click();
  link.remove();
}

function downloadAll(): void {
  items.filter((item) => item.compressedBlob).forEach((item, index) => {
    window.setTimeout(() => downloadItem(item), index * 150);
  });
}

function selectItem(id: string | null): void {
  selectedId = id;
  for (const item of items) item.card.style.outline = item.id === id ? '3px solid var(--color-primary)' : '';
  void renderSelected();
}

async function renderSelected(): Promise<void> {
  const item = findItem(selectedId);
  if (!item) {
    comparisonPanel.classList.remove('ui-settings-visible');
    return;
  }

  comparisonPanel.classList.add('ui-settings-visible');
  settingsFileName.textContent = item.file.name;
  originalSizeEl.textContent = formatBytes(item.file.size);
  qualityInput.value = String(item.quality);
  qualitySlider.value = String(item.quality);

  if (!item.compressedBlob || !item.compressedUrl) {
    compressedSizeEl.textContent = 'Not compressed';
    savingsPercentEl.textContent = '';
    await drawSingle(item.originalUrl);
    return;
  }

  compressedSizeEl.textContent = formatBytes(item.compressedBlob.size);
  const saving = Math.max(0, Math.round((1 - item.compressedBlob.size / item.file.size) * 100));
  savingsPercentEl.textContent = `(-${saving}%)`;
  await drawComparison(item.originalUrl, item.compressedUrl);
}

async function drawSingle(url: string): Promise<void> {
  const image = await loadBitmap(url);
  resizeCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawContain(ctx, image, canvas.width, canvas.height);
  image.close();
  positionThumb();
}

async function drawComparison(originalUrl: string, compressedUrl: string): Promise<void> {
  const [original, compressed] = await Promise.all([loadBitmap(originalUrl), loadBitmap(compressedUrl)]);
  resizeCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawContain(ctx, compressed, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width * split, canvas.height);
  ctx.clip();
  drawContain(ctx, original, canvas.width, canvas.height);
  ctx.restore();
  original.close();
  compressed.close();
  positionThumb();
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  return createImageBitmap(await response.blob());
}

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
}

function drawContain(ctx: CanvasRenderingContext2D, image: ImageBitmap, width: number, height: number): void {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function positionThumb(): void {
  thumb.style.left = `${split * 100}%`;
}

function setSplitFromEvent(event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  split = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  void renderSelected();
}

async function applyQuality(): Promise<void> {
  const item = findItem(selectedId);
  if (!item || processing) return;
  const quality = clampQuality(qualityInput.value);
  qualityInput.value = String(quality);
  qualitySlider.value = String(quality);
  settingsLoader.classList.remove('ui-loader-hidden');
  applyQualityBtn.disabled = true;
  await compressItem(item, quality);
  await renderSelected();
  settingsLoader.classList.add('ui-loader-hidden');
  applyQualityBtn.disabled = false;
  updateUi();
}

function updateUi(): void {
  const count = items.length;
  const doneCount = items.filter((item) => item.compressedBlob).length;
  const pendingCount = items.filter((item) => item.status !== 'done').length;
  clearBtn.disabled = count === 0 || processing;
  convertBtn.disabled = count === 0 || processing;
  downloadAllBtn.disabled = doneCount === 0;
  dropMessage.classList.toggle('ui-drop-caption-hidden', count > 0);
  convertCounter.style.display = pendingCount > 0 ? '' : 'none';
  convertCounter.textContent = String(pendingCount);
  downloadCounter.style.display = doneCount > 0 ? '' : 'none';
  downloadCounter.textContent = String(doneCount);
  updateScrollButtons();
}

function updateScrollButtons(): void {
  const maxScroll = filesScroll.scrollWidth - filesScroll.clientWidth;
  prevBtn.disabled = filesScroll.scrollLeft <= 0;
  nextBtn.disabled = maxScroll <= 0 || filesScroll.scrollLeft >= maxScroll - 1;
}

fileInput.addEventListener('change', () => {
  if (fileInput.files) addFiles(fileInput.files);
  fileInput.value = '';
});
clearBtn.addEventListener('click', clearAll);
convertBtn.addEventListener('click', () => void compressAll());
downloadAllBtn.addEventListener('click', downloadAll);
prevBtn.addEventListener('click', () => filesScroll.scrollBy({ left: -300, behavior: 'smooth' }));
nextBtn.addEventListener('click', () => filesScroll.scrollBy({ left: 300, behavior: 'smooth' }));
filesScroll.addEventListener('scroll', updateScrollButtons);
window.addEventListener('resize', () => void renderSelected());
zoomIndicator.addEventListener('click', () => void renderSelected());

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('ui-hint-shimmer');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('ui-hint-shimmer'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('ui-hint-shimmer');
  addFiles(Array.from(event.dataTransfer?.files ?? []));
});

qualitySlider.addEventListener('input', () => {
  qualityInput.value = qualitySlider.value;
});
qualityInput.addEventListener('input', () => {
  qualityInput.value = qualityInput.value.replace(/\D/g, '').slice(0, 3);
  qualitySlider.value = String(clampQuality(qualityInput.value));
});
applyQualityBtn.addEventListener('click', () => void applyQuality());

thumb.addEventListener('pointerdown', (event) => {
  draggingSplit = true;
  thumb.setPointerCapture(event.pointerId);
  thumb.classList.add('ui-thumb-active');
  setSplitFromEvent(event);
});
thumb.addEventListener('pointermove', (event) => {
  if (draggingSplit) setSplitFromEvent(event);
});
thumb.addEventListener('pointerup', (event) => {
  draggingSplit = false;
  thumb.releasePointerCapture(event.pointerId);
  thumb.classList.remove('ui-thumb-active');
});
canvas.addEventListener('pointerdown', setSplitFromEvent);

updateUi();
