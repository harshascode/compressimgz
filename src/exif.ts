type Status = 'pending' | 'reading' | 'ready' | 'processing' | 'done' | 'error';

type FileItem = {
  id: string;
  file: File;
  originalUrl: string;
  processedBlob?: Blob;
  processedUrl?: string;
  status: Status;
  card: HTMLLIElement;
  metadata?: Record<string, string>;
};

function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element ${id} not found`);
  return el as T;
}

const fileInput = mustGet<HTMLInputElement>('ui-fileInput');
const clearBtn = mustGet<HTMLButtonElement>('ui-clearBtn');
const removeAllBtn = mustGet<HTMLButtonElement>('ui-removeAllBtn');
const downloadAllBtn = mustGet<HTMLButtonElement>('ui-downloadAllBtn');
const dropZone = mustGet<HTMLDivElement>('ui-dropZone');
const dropMessage = mustGet<HTMLDivElement>('ui-dropMessage');
const filesContainer = mustGet<HTMLUListElement>('ui-filesContainer');
const template = mustGet<HTMLTemplateElement>('ui-fileCardTemplate');

const settingsPanel = mustGet<HTMLElement>('ui-settingsPanel');
const settingsFileName = mustGet<HTMLSpanElement>('ui-settingsFileName');
const settingsLoader = mustGet<HTMLSpanElement>('ui-settingsLoader');
const exifStatus = mustGet<HTMLParagraphElement>('ui-exifStatus');
const exifPanel = mustGet<HTMLDivElement>('ui-exifPanel');
const exifSearch = mustGet<HTMLInputElement>('ui-exifSearch');
const exifSearchClear = mustGet<HTMLButtonElement>('ui-exifSearchClear');
const removeExifBtn = mustGet<HTMLButtonElement>('ui-removeExifBtn');
const exifTableBody = mustGet<HTMLTableSectionElement>('ui-exifTableBody');
const noResults = mustGet<HTMLDivElement>('ui-noResults');
const noResultsQuery = mustGet<HTMLSpanElement>('ui-noResultsQuery');
const noExifData = mustGet<HTMLDivElement>('ui-noExifData');

let items: FileItem[] = [];
let selectedId: string | null = null;
let processingCount = 0;

const worker = new Worker(new URL('./exif-worker.ts', import.meta.url), { type: 'module' });

let nextWorkerRequestId = 1;
const workerRequests = new Map<number, {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
}>();

worker.addEventListener('message', (event) => {
  const msg = event.data;
  const req = workerRequests.get(msg.requestId);
  if (req) {
    workerRequests.delete(msg.requestId);
    if (msg.type === 'error') {
      req.reject(new Error(msg.message));
    } else {
      req.resolve(msg);
    }
  }
});

async function parseExifWithWorker(itemId: string, file: File): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const requestId = nextWorkerRequestId++;
    workerRequests.set(requestId, { resolve: (msg) => resolve(msg.metadata), reject });
    worker.postMessage({ type: 'parse', requestId, itemId, file });
  });
}

async function stripExifWithWorker(itemId: string, file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const requestId = nextWorkerRequestId++;
    workerRequests.set(requestId, { resolve: (msg) => resolve(msg.buffer), reject });
    worker.postMessage({ type: 'strip', requestId, itemId, file });
  });
}

function updateButtons() {
  const hasItems = items.length > 0;
  const hasRemovable = items.some(item => item.status === 'ready' && Object.keys(item.metadata || {}).length > 0);
  const hasDone = items.some(item => item.status === 'done');
  const isProcessing = processingCount > 0;

  clearBtn.disabled = !hasItems || isProcessing;
  removeAllBtn.disabled = !hasRemovable || isProcessing;
  downloadAllBtn.disabled = !hasDone;
}

function updateCardUI(item: FileItem) {
  const { card, status, metadata } = item;

  // Clear all visible states first
  card.querySelectorAll('.ui-file-state').forEach(el => 
    el.classList.remove('ui-file-state-visible')
  );
  
  const btn = card.querySelector('.ui-file-download') as HTMLButtonElement;
  btn.style.display = 'none';

  if (status === 'pending' || status === 'reading') {
    // Note: The HTML template uses ui-file-state-pending for the reading icon
    card.querySelector('.ui-file-state-pending')?.classList.add('ui-file-state-visible');
    const readEl = card.querySelector('.ui-file-state-pending .ui-file-state-text');
    if (readEl) readEl.textContent = 'READING...';
    
  } else if (status === 'ready') {
    const readyState = card.querySelector('.ui-file-state-ready');
    if (readyState) {
      readyState.classList.add('ui-file-state-visible');
      const keys = Object.keys(metadata || {});
      const textEl = readyState.querySelector('.ui-file-state-text-tags');
      if (textEl) textEl.textContent = keys.length > 0 ? `${keys.length} TAGS` : 'NO EXIF';
    }
    
  } else if (status === 'processing') {
    card.querySelector('.ui-file-state-pending')?.classList.add('ui-file-state-visible');
    const readEl = card.querySelector('.ui-file-state-pending .ui-file-state-text');
    if (readEl) readEl.textContent = 'STRIPPING...';
    
  } else if (status === 'done') {
    const readyState = card.querySelector('.ui-file-state-ready');
    if (readyState) {
      readyState.classList.add('ui-file-state-visible');
      const textEl = readyState.querySelector('.ui-file-state-text-tags');
      if (textEl) textEl.textContent = 'CLEAN';
    }
    btn.style.display = 'block';
    
  } else if (status === 'error') {
    card.querySelector('.ui-file-state-error')?.classList.add('ui-file-state-visible');
  }
}

async function processFile(item: FileItem) {
  item.status = 'reading';
  updateCardUI(item);
  try {
    const metadata = await parseExifWithWorker(item.id, item.file);
    item.metadata = metadata;
    item.status = 'ready';
  } catch (err) {
    item.status = 'error';
    const detail = item.card.querySelector('.ui-file-state-detail');
    if (detail) detail.textContent = String(err);
  }
  updateCardUI(item);
  updateButtons();
  if (selectedId === item.id) selectItem(item.id);
}

function selectItem(id: string | null) {
  selectedId = id;
  const item = items.find(i => i.id === id);
  items.forEach(i => i.card.classList.toggle('ui-file-active', i.id === id));
  
  if (!item) {
    settingsPanel.classList.remove('ui-settings-visible');
    return;
  }
  
  settingsPanel.classList.add('ui-settings-visible');
  settingsFileName.textContent = item.file.name;
  
  if (item.status === 'reading' || item.status === 'pending') {
    settingsLoader.classList.remove('ui-loader-hidden');
    exifPanel.style.display = 'none';
    noExifData.style.display = 'none';
    removeExifBtn.disabled = true;
    exifStatus.textContent = '';
  } else if (item.status === 'ready' || item.status === 'done') {
    settingsLoader.classList.add('ui-loader-hidden');
    const keys = Object.keys(item.metadata || {});
    if (keys.length === 0 && item.status !== 'done') {
      exifPanel.style.display = 'none';
      noExifData.style.display = 'block';
      noExifData.textContent = 'No metadata found in this file.';
      removeExifBtn.disabled = true;
      exifStatus.textContent = '';
    } else if (item.status === 'done') {
      exifPanel.style.display = 'none';
      noExifData.style.display = 'block';
      noExifData.textContent = 'EXIF data removed successfully.';
      noExifData.className = 'ui-exif-panel-empty ui-exif-panel-empty-success';
      removeExifBtn.disabled = true;
      exifStatus.textContent = 'Clean';
    } else {
      exifPanel.style.display = 'block';
      noExifData.style.display = 'none';
      removeExifBtn.disabled = false;
      exifStatus.textContent = `${keys.length} tags found`;
      renderTable(item.metadata!);
    }
  }
}

function renderTable(metadata: Record<string, string>, filter = '') {
  exifTableBody.innerHTML = '';
  const entries = Object.entries(metadata);
  let count = 0;
  for (const [key, val] of entries) {
    if (filter && !key.toLowerCase().includes(filter.toLowerCase()) && !String(val).toLowerCase().includes(filter.toLowerCase())) continue;
    count++;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="ui-exif-panel-td ui-exif-panel-td-tag">${key}</td><td class="ui-exif-panel-td ui-exif-panel-td-value">${val}</td>`;
    exifTableBody.appendChild(tr);
  }
  
  if (count === 0 && filter) {
    noResults.style.display = 'block';
    noResultsQuery.textContent = filter;
  } else {
    noResults.style.display = 'none';
  }
}

exifSearch.addEventListener('input', () => {
  const item = items.find(i => i.id === selectedId);
  if (item && item.metadata) {
    renderTable(item.metadata, exifSearch.value);
  }
});

exifSearchClear.addEventListener('click', () => {
  exifSearch.value = '';
  exifSearch.dispatchEvent(new Event('input'));
});

async function removeExif(item: FileItem) {
  if (item.status !== 'ready' || Object.keys(item.metadata || {}).length === 0) return;
  
  processingCount++;
  updateButtons();
  item.status = 'processing';
  updateCardUI(item);
  
  try {
    const buffer = await stripExifWithWorker(item.id, item.file);
    item.processedBlob = new Blob([buffer], { type: item.file.type });
    item.processedUrl = URL.createObjectURL(item.processedBlob);
    item.status = 'done';
  } catch (err) {
    item.status = 'error';
    const detail = item.card.querySelector('.ui-file-state-detail');
    if (detail) detail.textContent = String(err);
  }
  
  processingCount--;
  updateCardUI(item);
  updateButtons();
  if (selectedId === item.id) selectItem(item.id);
}

removeExifBtn.addEventListener('click', () => {
  const item = items.find(i => i.id === selectedId);
  if (item) removeExif(item);
});

removeAllBtn.addEventListener('click', () => {
  items.forEach(item => {
    if (item.status === 'ready' && Object.keys(item.metadata || {}).length > 0) {
      removeExif(item);
    }
  });
});

downloadAllBtn.addEventListener('click', () => {
  items.forEach(item => {
    if (item.status === 'done' && item.processedUrl) {
      const a = document.createElement('a');
      a.href = item.processedUrl;
      a.download = item.file.name.replace(/\.[^/.]+$/, "") + "-cleaned" + item.file.name.match(/\.[^/.]+$/)?.[0];
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  });
});

function handleFiles(files: FileList | File[]) {
  Array.from(files).slice(0, 20).forEach(file => {
    const id = Math.random().toString(36).substring(2, 9);
    const card = document.importNode(template.content, true).querySelector('li')!;
    card.dataset.id = id;
    card.querySelector('.ui-file-title')!.textContent = file.name;
    
    const url = URL.createObjectURL(file);
    const img = card.querySelector('.ui-file-image') as HTMLImageElement;
    if (file.type.startsWith('image/')) {
      img.src = url;
      img.classList.remove('ui-file-image-hidden', 'file-image-hidden');
    }
    
    const item: FileItem = { id, file, originalUrl: url, status: 'pending', card };
    items.push(item);
    filesContainer.appendChild(card);
    
    card.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.ui-file-close') || (e.target as Element).closest('.ui-file-download')) return;
      selectItem(id);
    });
    
    card.querySelector('.ui-file-close')!.addEventListener('click', () => {
      card.remove();
      items = items.filter(i => i.id !== id);
      if (selectedId === id) selectItem(items[0]?.id || null);
      updateButtons();
    });
    
    card.querySelector('.ui-file-download')!.addEventListener('click', () => {
      if (item.status === 'done' && item.processedUrl) {
        const a = document.createElement('a');
        a.href = item.processedUrl;
        a.download = item.file.name.replace(/\.[^/.]+$/, "") + "-cleaned" + item.file.name.match(/\.[^/.]+$/)?.[0];
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
    
    processFile(item);
  });
  
  if (items.length > 0 && !selectedId) selectItem(items[0].id);
  
  dropMessage.style.display = 'none';
  updateButtons();
}

fileInput.addEventListener('change', () => {
  if (fileInput.files) handleFiles(fileInput.files);
  fileInput.value = '';
});

clearBtn.addEventListener('click', () => {
  items.forEach(i => i.card.remove());
  items = [];
  selectItem(null!);
  dropMessage.style.display = 'flex';
  updateButtons();
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('ui-files-list-outer-drag'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('ui-files-list-outer-drag'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('ui-files-list-outer-drag');
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
});

updateButtons();
