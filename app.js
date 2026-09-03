// Configure PDF.js worker
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js';
}

// Global Application State
let baseCanvas = document.createElement('canvas'); // Offscreen pristine render
let baseCtx = baseCanvas.getContext('2d');
let currentPdfScale = 2.0; // High DPI scale factor
let pdfDoc = null;
let currentZoom = 1.0;
let isManualRideText = false;

// DOM Elements
const canvas = document.getElementById('imageCanvas');
const ctx = canvas.getContext('2d');
const imageInfo = document.getElementById('imageInfo');
const toastEl = document.getElementById('toast');

// Inputs
const rideDateInput = document.getElementById('rideDate');
const rideTimeInput = document.getElementById('rideTime');
const busNumberInput = document.getElementById('busNumber');
const rideTextPreview = document.getElementById('rideTextPreview');
const manualRideText = document.getElementById('manualRideText');
const manualTextContainer = document.getElementById('manualTextContainer');
const quickRideFields = document.getElementById('quickRideFields');

const transferDateInput = document.getElementById('transferDate');
const syncCreatedDate = document.getElementById('syncCreatedDate');
const createdDatePreview = document.getElementById('createdDatePreview');

const paymentAmountInput = document.getElementById('paymentAmount');

// Buttons
const btnRideToday = document.getElementById('btnRideToday');
const btnRideNow = document.getElementById('btnRideNow');
const btnToggleManualText = document.getElementById('btnToggleManualText');
const btnBackToQuick = document.getElementById('btnBackToQuick');
const btnTransferNow = document.getElementById('btnTransferNow');
const btnResetAmount = document.getElementById('btnResetAmount');

const btnUpload = document.getElementById('btnUpload');
const uploadInput = document.getElementById('uploadInput');
const btnReset = document.getElementById('btnReset');

const btnDownloadPdf = document.getElementById('btnDownloadPdf');
const btnDownloadPng = document.getElementById('btnDownloadPng');
const btnCopyImage = document.getElementById('btnCopyImage');

const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');
const zoomFitBtn = document.getElementById('zoomFit');
const zoomLabel = document.getElementById('zoomLabel');

// Toast Feedback
function showToast(message, isSuccess = true) {
  toastEl.textContent = message;
  toastEl.style.backgroundColor = isSuccess ? '#10b981' : '#ef4444';
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// 1. Local Device Time Helper (for actual bus ride)
function getLocalNow() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    dateStr: `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`,
    timeShortStr: `${pad(now.getHours())}:${pad(now.getMinutes())}`
  };
}

// 2. Moscow Timezone (MSK / UTC+3) Helper (for bank transfer stamp)
function getMoscowNow() {
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const m = {};
  parts.forEach(p => m[p.type] = p.value);
  return {
    dateStr: `${m.day}.${m.month}.${m.year}`,
    timeShortStr: `${m.hour}:${m.minute}`,
    timeFullStr: `${m.hour}:${m.minute}:${m.second}`,
    fullTransferStr: `${m.day}.${m.month}.${m.year} ${m.hour}:${m.minute}:${m.second} мск`
  };
}

// Compute Created Date (+4 mins from transfer date)
function computeCreatedDate(transferDateStr) {
  const regex = /(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/;
  const match = transferDateStr.match(regex);
  if (match) {
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    const hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    const seconds = match[6] ? parseInt(match[6], 10) : 0;

    const dateObj = new Date(year, month, day, hours, minutes, seconds);
    dateObj.setMinutes(dateObj.getMinutes() + 4);

    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(dateObj.getDate())}.${pad(dateObj.getMonth() + 1)}.${dateObj.getFullYear()} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())} мск`;
  }
  return transferDateStr.replace(/:\d{2}\s+мск/, ' мск');
}

// Update Ride Text Preview and State
function updateRideText() {
  if (isManualRideText) {
    const lines = manualRideText.value.split('\n');
    rideTextPreview.innerHTML = lines.map(escapeHtml).join('<br>');
  } else {
    const d = rideDateInput.value.trim();
    const t = rideTimeInput.value.trim();
    const b = busNumberInput.value.trim();

    const line1 = `Оплата поездки от ${d} ${t}, Автобус`;
    const line2 = `${b}`;
    rideTextPreview.innerHTML = `${escapeHtml(line1)}<br>${escapeHtml(line2)}`;
  }
}

// Update Created Date Preview
function updateCreatedPreview() {
  if (syncCreatedDate.checked) {
    const createdText = computeCreatedDate(transferDateInput.value);
    createdDatePreview.textContent = `Вверху будет: ${createdText}`;
  } else {
    createdDatePreview.textContent = 'Вверху дата останется исходной';
  }
}

// Fast Template Loader
function loadTemplateImage(src = 'receipt_template.png') {
  imageInfo.textContent = 'Загрузка...';
  const img = new Image();
  img.onload = () => {
    canvas.width = img.naturalWidth || 1190;
    canvas.height = img.naturalHeight || 1683;
    baseCanvas.width = canvas.width;
    baseCanvas.height = canvas.height;
    baseCtx.drawImage(img, 0, 0);
    imageInfo.textContent = `Квитанция A4: ${canvas.width} × ${canvas.height} px`;
    fitCanvas();
    draw();
  };
  img.onerror = () => {
    console.warn('Image load error, trying PDF fallback');
    loadPdfDocument('receipt_template.pdf');
  };
  img.src = src;
}

// Fallback PDF loader
async function loadPdfDocument(source) {
  try {
    imageInfo.textContent = 'Рендеринг PDF...';

    let loadingTask;
    if (typeof source === 'string') {
      loadingTask = pdfjsLib.getDocument(source);
    } else {
      loadingTask = pdfjsLib.getDocument({ data: source });
    }

    pdfDoc = await loadingTask.promise;
    const page = await pdfDoc.getPage(1);

    const viewport = page.getViewport({ scale: currentPdfScale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    baseCanvas.width = viewport.width;
    baseCanvas.height = viewport.height;

    await page.render({
      canvasContext: baseCtx,
      viewport: viewport
    }).promise;

    imageInfo.textContent = `PDF A4: ${Math.round(viewport.width)} × ${Math.round(viewport.height)} px`;
    fitCanvas();
    draw();
  } catch (err) {
    console.error('Failed to render PDF:', err);
    imageInfo.textContent = 'Ошибка загрузки';
    showToast('Не удалось загрузить файл', false);
  }
}

// Draw main canvas
function draw() {
  if (!baseCanvas.width || !baseCanvas.height) return;

  // 1. Draw pristine original receipt base
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseCanvas, 0, 0);

  const S = currentPdfScale; // 2.0
  const fontFam = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  // 1. НАЗНАЧЕНИЕ ПЛАТЕЖА
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(33 * S, 296 * S, 260 * S, 34 * S);

  ctx.fillStyle = '#000000';
  ctx.font = `${12 * S}px ${fontFam}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  let rideLines = [];
  if (isManualRideText) {
    rideLines = manualRideText.value.split('\n');
  } else {
    const d = rideDateInput.value.trim() || '29.08.2026';
    const t = rideTimeInput.value.trim() || '14:53';
    const b = busNumberInput.value.trim() || '14';
    rideLines = [
      `Оплата поездки от ${d} ${t}, Автобус`,
      `${b}`
    ];
  }

  const startX = 35.45 * S;
  const line1Y = (841.9 - 535.606) * S;
  const line2Y = (841.9 - 520.005) * S;

  if (rideLines[0]) ctx.fillText(rideLines[0], startX, line1Y);
  if (rideLines[1]) ctx.fillText(rideLines[1], startX, line2Y);

  // 2. ДАТА ОТПРАВКИ ПЕРЕВОДА
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(302 * S, 168 * S, 180 * S, 15 * S);

  const transferText = transferDateInput.value.trim() || '29.08.2026 11:53:21 мск';
  ctx.fillStyle = '#000000';
  ctx.font = `${12 * S}px ${fontFam}`;
  ctx.fillText(transferText, 304.75 * S, (841.9 - 664.288) * S);

  // 3. СФОРМИРОВАНА (дата вверху справа)
  if (syncCreatedDate.checked) {
    const createdText = computeCreatedDate(transferText);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(445 * S, 53 * S, 125 * S, 13 * S);

    ctx.fillStyle = '#595959';
    ctx.font = `${11 * S}px ${fontFam}`;
    ctx.fillText(createdText, 452.79 * S, (841.9 - 779.15) * S);
  }

  // 4. СУММА ПЛАТЕЖА (по умолчанию 40 RUR)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(33 * S, 211 * S, 100 * S, 14 * S);

  const amount = paymentAmountInput.value.trim() || '40';
  const amountText = `${amount} RUR`;
  ctx.fillStyle = '#000000';
  ctx.font = `${12 * S}px ${fontFam}`;
  ctx.fillText(amountText, 35.45 * S, (841.9 - 621.394) * S);
}

// Input listeners
[rideDateInput, rideTimeInput, busNumberInput].forEach(el => {
  el.addEventListener('input', () => {
    updateRideText();
    draw();
  });
});

manualRideText.addEventListener('input', () => {
  updateRideText();
  draw();
});

transferDateInput.addEventListener('input', () => {
  updateCreatedPreview();
  draw();
});

syncCreatedDate.addEventListener('change', () => {
  updateCreatedPreview();
  draw();
});

paymentAmountInput.addEventListener('input', draw);

// Кнопки Назначения платежа (ВАШЕ МЕСТНОЕ ВРЕМЯ)
btnRideToday.addEventListener('click', () => {
  const local = getLocalNow();
  rideDateInput.value = local.dateStr;
  updateRideText();
  draw();
  showToast(`Дата поездки: ${local.dateStr} (местная)`);
});

btnRideNow.addEventListener('click', () => {
  const local = getLocalNow();
  rideTimeInput.value = local.timeShortStr;
  updateRideText();
  draw();
  showToast(`Время поездки: ${local.timeShortStr} (местное)`);
});

btnToggleManualText.addEventListener('click', () => {
  isManualRideText = true;
  manualRideText.value = `Оплата поездки от ${rideDateInput.value} ${rideTimeInput.value}, Автобус\n${busNumberInput.value}`;
  manualTextContainer.style.display = 'block';
  quickRideFields.style.display = 'none';
  updateRideText();
  draw();
});

btnBackToQuick.addEventListener('click', () => {
  isManualRideText = false;
  manualTextContainer.style.display = 'none';
  quickRideFields.style.display = 'block';
  updateRideText();
  draw();
});

// Кнопка Даты перевода (МОСКОВСКОЕ ВРЕМЯ МСК)
btnTransferNow.addEventListener('click', () => {
  const msk = getMoscowNow();
  transferDateInput.value = msk.fullTransferStr;
  updateCreatedPreview();
  draw();
  showToast(`Время перевода: ${msk.timeFullStr} (МСК)`);
});

btnResetAmount.addEventListener('click', () => {
  paymentAmountInput.value = '40';
  draw();
  showToast('Сумма: 40 RUR');
});

// Upload
btnUpload.addEventListener('click', () => uploadInput.click());

uploadInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const arrayBuffer = await file.arrayBuffer();
    loadPdfDocument(new Uint8Array(arrayBuffer));
    showToast('PDF загружен!');
  } else {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        baseCanvas.width = img.naturalWidth;
        baseCanvas.height = img.naturalHeight;
        baseCtx.drawImage(img, 0, 0);
        fitCanvas();
        draw();
        showToast('Изображение загружено!');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }
});

// Reset
btnReset.addEventListener('click', () => {
  if (confirm('Сбросить все поля к исходным?')) {
    rideDateInput.value = '29.08.2026';
    rideTimeInput.value = '14:53';
    busNumberInput.value = '14';
    isManualRideText = false;
    manualTextContainer.style.display = 'none';
    quickRideFields.style.display = 'block';

    transferDateInput.value = '29.08.2026 11:53:21 мск';
    syncCreatedDate.checked = true;

    paymentAmountInput.value = '40';

    updateRideText();
    updateCreatedPreview();
    draw();
    showToast('Данные сброшены');
  }
});

// Download PDF
btnDownloadPdf.addEventListener('click', () => {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast('Библиотека jsPDF загружается...', false);
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: [595.28, 841.89] // Standard A4
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.98);
  pdf.addImage(imgData, 'JPEG', 0, 0, 595.28, 841.89);

  const rDate = rideDateInput.value.replace(/\./g, '-');
  const bus = busNumberInput.value.trim();
  pdf.save(`kvitantsiya_${rDate}_avtobus_${bus}.pdf`);

  showToast('PDF документ скачан!');
});

// Download PNG
btnDownloadPng.addEventListener('click', () => {
  const dataUrl = canvas.toDataURL('image/png', 1.0);
  const link = document.createElement('a');
  const rDate = rideDateInput.value.replace(/\./g, '-');
  const bus = busNumberInput.value.trim();
  link.download = `kvitantsiya_${rDate}_avtobus_${bus}.png`;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('PNG сохранено!');
});

// Copy to Clipboard
btnCopyImage.addEventListener('click', () => {
  canvas.toBlob(async (blob) => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      showToast('Картинка скопирована!');
    } catch (err) {
      console.error(err);
      showToast('Нажмите "Скачать PNG"', false);
    }
  }, 'image/png');
});

// Zoom Controls
function setZoom(factor) {
  currentZoom = Math.max(0.5, Math.min(2.5, factor));
  if (currentZoom === 1.0) {
    canvas.style.transform = 'none';
  } else {
    canvas.style.transform = `scale(${currentZoom})`;
    canvas.style.transformOrigin = 'top center';
  }
  zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
}

function fitCanvas() {
  currentZoom = 1.0;
  canvas.style.transform = 'none';
  zoomLabel.textContent = '100%';
}

zoomInBtn.addEventListener('click', () => setZoom(currentZoom + 0.15));
zoomOutBtn.addEventListener('click', () => setZoom(currentZoom - 0.15));
zoomFitBtn.addEventListener('click', fitCanvas);

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.addEventListener('resize', fitCanvas);

// Init
window.addEventListener('DOMContentLoaded', () => {
  updateRideText();
  updateCreatedPreview();
  loadTemplateImage('receipt_template.png');
});
