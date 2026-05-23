type Status = 'pending' | 'processing' | 'done' | 'error';

export type FormatConfig = {
  createWorker: () => Worker;
  workerErrorLabel: string;
  mimeType: string;
  filePattern: RegExp;
  outputName: (name: string) => string;
  formatLabel: string;
  defaultQuality?: number;
};

type FileItem = {
  id: string;
  file: File;
  originalUrl: string;
  compressedBlob?: Blob;
  compressedUrl?: string;
  quality: number;
  status: Status;
  card: HTMLLIElement;
  format: FormatConfig;
};

export type ImageCompressorConfig = FormatConfig | FormatConfig[];

type Language = {
  code: string;
  name: string;
};

function getLanguageHref(code: string, currentLang: string, currentPath: string): string {
  let path = currentPath || window.location.pathname || '/';
  if (!path.startsWith('/')) path = `/${path}`;

  if (currentLang !== 'en') {
    path = path.replace(new RegExp(`^/${currentLang}(?=/|$)`), '') || '/';
  }

  return code === 'en' ? path : `/${code}${path === '/' ? '/' : path}`;
}

export function initLanguageSelectors(): void {
  document.querySelectorAll<HTMLElement>('.ui-language').forEach((selector) => {
    const button = selector.querySelector<HTMLButtonElement>('.ui-language-button');
    const list = selector.querySelector<HTMLUListElement>('.ui-language-list');
    const encodedLanguages = selector.dataset.languages;
    if (!button || !list || !encodedLanguages) return;

    let languages: Language[] = [];
    try {
      languages = JSON.parse(decodeURIComponent(encodedLanguages)) as Language[];
    } catch {
      return;
    }

    const currentLang = selector.dataset.currentLang || document.documentElement.lang || 'en';
    const currentPath = selector.dataset.currentPath || window.location.pathname || '/';
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');

    list.replaceChildren(...languages.map((language) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'ui-language-title';
      link.href = getLanguageHref(language.code, currentLang, currentPath);
      link.textContent = language.name;
      link.lang = language.code;
      if (language.code === currentLang) {
        link.classList.add('ui-language-title-selected');
        link.setAttribute('aria-current', 'true');
      }
      item.append(link);
      return item;
    }));

    const setOpen = (open: boolean) => {
      selector.classList.toggle('ui-language-active', open);
      button.setAttribute('aria-expanded', String(open));
    };

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(!selector.classList.contains('ui-language-active'));
    });

    selector.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });
  });
}

export function initNavigation(): void {
  const container = document.querySelector<HTMLElement>('.ui-page-switch');
  const activeTab = document.querySelector<HTMLElement>('.ui-site-switch-tab-active');
  if (container && activeTab) {
    const scrollLeft = activeTab.offsetLeft - (container.clientWidth / 2) + (activeTab.clientWidth / 2);
    container.scrollLeft = scrollLeft;
  }
}

export function initImageCompressor(config: ImageCompressorConfig): void {
  const formats = Array.isArray(config) ? config : [config];
  const MAX_FILES = 20;

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
  let zoom = 1;
  let draggingSplit = false;
  let processing = false;
  const bitmapCache = new Map<string, Promise<ImageBitmap>>();
  
  const workers = new Map<FormatConfig, Worker>();
  let nextWorkerRequestId = 1;
  const workerRequests = new Map<number, {
    resolve: (buffer: ArrayBuffer) => void;
    reject: (error: Error) => void;
  }>();

  type WorkerRequest = {
    type: 'compress';
    requestId: number;
    itemId: string;
    buffer: ArrayBuffer;
    quality: number;
  } | {
    type: 'release';
    itemId: string;
  } | {
    type: 'clear';
  };

  type WorkerResponse = {
    type: 'compressed';
    requestId: number;
    itemId: string;
    buffer: ArrayBuffer;
  } | {
    type: 'error';
    requestId: number;
    itemId: string;
    message: string;
  };

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 10;

  function mustGet<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing element #${id}`);
    return element as T;
  }

  function getWorker(format: FormatConfig): Worker {
    let worker = workers.get(format);
    if (!worker) {
      worker = format.createWorker();
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        const request = workerRequests.get(message.requestId);
        if (!request) return;

        workerRequests.delete(message.requestId);
        if (message.type === 'compressed') {
          request.resolve(message.buffer);
        } else {
          request.reject(new Error(message.message));
        }
      });

      worker.addEventListener('error', (event) => {
        for (const [requestId, request] of workerRequests) {
          request.reject(new Error(event.message || `${format.workerErrorLabel} worker failed.`));
          workerRequests.delete(requestId);
        }
      });
      workers.set(format, worker);
    }
    return worker;
  }

  function postWorkerMessage(format: FormatConfig, message: WorkerRequest, transfer?: Transferable[]): void {
    getWorker(format).postMessage(message, transfer ?? []);
  }

  async function encodeInWorker(item: FileItem, quality: number): Promise<ArrayBuffer> {
    const requestId = nextWorkerRequestId++;
    const buffer = await item.file.arrayBuffer();

    return new Promise((resolve, reject) => {
      workerRequests.set(requestId, { resolve, reject });
      postWorkerMessage(item.format, {
        type: 'compress',
        requestId,
        itemId: item.id,
        buffer,
        quality,
      }, [buffer]);
    });
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  }

  function isAcceptedFile(file: File): FormatConfig | undefined {
    return formats.find(f => file.type === f.mimeType || f.filePattern.test(file.name));
  }

  function clampQuality(value: string | number, defaultQuality = 80): number {
    const numberValue = typeof value === 'number' ? value : Number.parseInt(value, 10);
    if (Number.isNaN(numberValue)) return defaultQuality;
    return Math.min(100, Math.max(10, numberValue));
  }

  function addFiles(fileList: FileList | File[]): void {
    const room = MAX_FILES - items.length;
    const files = Array.from(fileList).slice(0, room);

    for (const file of files) {
      const format = isAcceptedFile(file);
      if (!format) continue;

      const id = crypto.randomUUID();
      const card = createCard(id, file, format);
      const item: FileItem = {
        id,
        file,
        originalUrl: URL.createObjectURL(file),
        quality: format.defaultQuality ?? 80,
        status: 'pending',
        card,
        format,
      };
      items.push(item);
      filesContainer.append(card);
      setCardState(item, 'pending');
    }

    if (!selectedId && items[0]) selectItem(items[0].id);
    updateUi();
  }

  function createCard(id: string, file: File, format: FormatConfig): HTMLLIElement {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const card = fragment.querySelector<HTMLLIElement>('.ui-file');
    if (!card) throw new Error('Invalid file card template');
    card.dataset.id = id;
    card.querySelector<HTMLElement>('.ui-file-title')!.textContent = file.name;
    card.querySelector<HTMLImageElement>('.ui-file-image')!.src = URL.createObjectURL(file);
    card.querySelector<HTMLElement>('.ui-file-state-text-format')!.textContent = format.formatLabel;
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
      button.classList.remove('ui-file-button-hidden');
      buttonText.textContent = 'PROCESSING...';
    } else if (status === 'error') {
      const errorState = card.querySelector<HTMLElement>('.ui-file-state-error')!;
      errorState.classList.add('ui-file-state-visible', 'file__state_visible');
      errorState.querySelector<HTMLElement>('.ui-file-state-detail')!.textContent = detail;
    } else {
      const doneState = card.querySelector<HTMLElement>('.ui-file-state-done')!;
      const saving = item.compressedBlob ? Math.max(0, Math.round((1 - item.compressedBlob.size / item.file.size) * 100)) : 0;
      doneState.classList.add('ui-file-state-visible');
      doneState.querySelector<HTMLElement>('.ui-file-state-text-format')!.textContent = `-${saving}%`;
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
    postWorkerMessage(item.format, { type: 'release', itemId: item.id });
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
      const buffer = await encodeInWorker(item, quality);
      if (!items.includes(item)) return;
      if (item.compressedUrl) URL.revokeObjectURL(item.compressedUrl);
      item.quality = quality;

      const encodedBlob = new Blob([buffer], { type: item.format.mimeType });
      const outputBlob = encodedBlob.size >= item.file.size ? item.file : encodedBlob;

      item.compressedBlob = outputBlob;
      item.compressedUrl = URL.createObjectURL(outputBlob);
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
    link.download = item.format.outputName(item.file.name);
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
    if (selectedId !== id) resetZoom(false);
    selectedId = id;
    for (const item of items) item.card.style.outline = item.id === id ? '3px solid var(--color-primary)' : '';
    void renderSelected();
  }

  async function renderSelected(): Promise<void> {
    const item = findItem(selectedId);
    if (!item?.compressedBlob || !item.compressedUrl) {
      comparisonPanel.classList.remove('ui-settings-visible');
      return;
    }

    comparisonPanel.classList.add('ui-settings-visible');
    settingsFileName.textContent = item.file.name;
    originalSizeEl.textContent = formatBytes(item.file.size);
    qualityInput.value = String(item.quality);
    qualitySlider.value = String(item.quality);
    compressedSizeEl.textContent = formatBytes(item.compressedBlob.size);
    const saving = Math.max(0, Math.round((1 - item.compressedBlob.size / item.file.size) * 100));
    savingsPercentEl.textContent = `(-${saving}%)`;
    await drawComparison(item.originalUrl, item.compressedUrl);
  }

  async function drawComparison(originalUrl: string, compressedUrl: string): Promise<void> {
    const [original, compressed] = await Promise.all([loadBitmap(originalUrl), loadBitmap(compressedUrl)]);
    resizeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawZoomedContain(ctx, compressed, canvas.width, canvas.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width * split, canvas.height);
    ctx.clip();
    drawZoomedContain(ctx, original, canvas.width, canvas.height);
    ctx.restore();
    positionThumb();
    updateZoomIndicator();
  }

  async function loadBitmap(url: string): Promise<ImageBitmap> {
    let bitmapPromise = bitmapCache.get(url);
    if (!bitmapPromise) {
      bitmapPromise = fetch(url).then(async (response) => createImageBitmap(await response.blob()));
      bitmapCache.set(url, bitmapPromise);
    }
    return bitmapPromise;
  }

  function resizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }

  function drawZoomedContain(ctx: CanvasRenderingContext2D, image: ImageBitmap, width: number, height: number): void {
    const scale = Math.min(width / image.width, height / image.height) * zoom;
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function updateZoomIndicator(): void {
    const zoomPercent = Math.round(zoom * 100);
    zoomIndicator.querySelector<HTMLElement>('.ui-zoom-indicator-text')!.textContent = `${zoomPercent}%`;
    zoomIndicator.classList.toggle('ui-zoom-indicator-hidden', zoom === 1);
  }

  function resetZoom(render = true): void {
    zoom = 1;
    updateZoomIndicator();
    if (render) void renderSelected();
  }

  function handleZoom(event: WheelEvent): void {
    if (!comparisonPanel.classList.contains('ui-settings-visible')) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    void renderSelected();
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
    const quality = clampQuality(qualityInput.value, item.format.defaultQuality);
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
  zoomIndicator.addEventListener('click', () => resetZoom());
  canvas.addEventListener('wheel', handleZoom, { passive: false });

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
    const item = findItem(selectedId);
    qualitySlider.value = String(clampQuality(qualityInput.value, item?.format.defaultQuality));
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

  initLanguageSelectors();
  initNavigation();
  updateUi();
}
