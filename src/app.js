import {
  buildReport,
  createPdfDocument,
  formatCurrency,
  parseExpenseText,
  parseReceiptText,
  toCsv,
  toISODate
} from './ledger.js';

const STORAGE_KEY = 'expense-chatbot-ledger-v1';
const $ = (selector) => document.querySelector(selector);

const state = {
  expenses: loadExpenses(),
  selectedImage: null
};

const elements = {
  messages: $('#messages'),
  messageTemplate: $('#message-template'),
  chatForm: $('#chat-form'),
  chatInput: $('#chat-input'),
  table: $('#expense-table'),
  todayTotal: $('#today-total'),
  weekTotal: $('#week-total'),
  monthTotal: $('#month-total'),
  topCategory: $('#top-category'),
  reportPeriod: $('#report-period'),
  reportDate: $('#report-date'),
  reportSummary: $('#report-summary'),
  downloadCsv: $('#download-csv'),
  downloadPdf: $('#download-pdf'),
  receiptFile: $('#receipt-file'),
  receiptPreview: $('#receipt-preview'),
  dropZone: $('#drop-zone'),
  runOcr: $('#run-ocr'),
  ocrText: $('#ocr-text'),
  importOcr: $('#import-ocr'),
  seedDemo: $('#seed-demo'),
  clearData: $('#clear-data')
};

elements.reportDate.value = toISODate(new Date());

boot();

function boot() {
  bindEvents();
  addBotMessage('你好！請輸入「午餐 120」或「昨天交通 45」，也可以上傳單據截圖。我也能處理「產生本月 PDF 報告」等要求。');
  render();
}

function bindEvents() {
  elements.chatForm.addEventListener('submit', handleChatSubmit);
  elements.reportPeriod.addEventListener('change', render);
  elements.reportDate.addEventListener('change', render);
  elements.downloadCsv.addEventListener('click', () => downloadReport('csv'));
  elements.downloadPdf.addEventListener('click', () => downloadReport('pdf'));
  elements.receiptFile.addEventListener('change', (event) => handleFile(event.target.files?.[0]));
  elements.dropZone.addEventListener('click', () => elements.receiptFile.click());
  elements.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('dragging');
  });
  elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('dragging'));
  elements.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragging');
    handleFile(event.dataTransfer.files?.[0]);
  });
  elements.runOcr.addEventListener('click', runOcr);
  elements.importOcr.addEventListener('click', importOcrText);
  elements.seedDemo.addEventListener('click', seedDemoData);
  elements.clearData.addEventListener('click', clearData);
}

function handleChatSubmit(event) {
  event.preventDefault();
  const text = elements.chatInput.value.trim();
  if (!text) return;

  addUserMessage(text);
  elements.chatInput.value = '';

  if (isReportIntent(text)) {
    const period = detectPeriod(text);
    elements.reportPeriod.value = period;
    render();
    addBotMessage(`已為你產生${periodLabel(period)}報告，可在下方預覽，也可下載 PDF 或 CSV。`);
    if (/pdf/i.test(text)) downloadReport('pdf');
    if (/csv/i.test(text)) downloadReport('csv');
    return;
  }

  const parsed = parseExpenseText(text);
  if (parsed.length) {
    addExpenses(parsed);
    addBotMessage(`已新增 ${parsed.length} 筆帳目：${parsed.map((item) => `${item.item} ${formatCurrency(item.amount)}`).join('、')}。`);
  } else {
    addBotMessage('我沒有找到金額。請試試「今天 咖啡 80」或上傳單據後執行 OCR。');
  }
}

function isReportIntent(text) {
  return /報告|統計|摘要|匯出|下載|pdf|csv/i.test(text);
}

function detectPeriod(text) {
  if (/日|今天|每日|daily/i.test(text)) return 'day';
  if (/週|周|week/i.test(text)) return 'week';
  if (/月|month/i.test(text)) return 'month';
  return elements.reportPeriod.value;
}

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    addBotMessage('請上傳圖片格式的單據或付款截圖。');
    return;
  }
  state.selectedImage = file;
  const url = URL.createObjectURL(file);
  elements.receiptPreview.src = url;
  elements.receiptPreview.hidden = false;
  addBotMessage(`已載入圖片「${file.name}」，請按「開始 OCR 辨識」。`);
}

async function runOcr() {
  if (!state.selectedImage) {
    addBotMessage('請先選擇一張單據或付款截圖。');
    return;
  }
  if (!window.Tesseract) {
    addBotMessage('OCR 套件尚未載入。你仍可以手動貼上單據文字再匯入。');
    return;
  }

  elements.runOcr.disabled = true;
  elements.runOcr.textContent = '辨識中...';
  try {
    const result = await window.Tesseract.recognize(state.selectedImage, 'eng+chi_tra', {
      logger(message) {
        if (message.status) elements.runOcr.textContent = `${message.status} ${Math.round((message.progress || 0) * 100)}%`;
      }
    });
    elements.ocrText.value = result.data.text.trim();
    addBotMessage('OCR 完成，請確認文字後按「將內容匯入帳目」。');
  } catch (error) {
    addBotMessage(`OCR 失敗：${error.message}。可改用手動貼上文字。`);
  } finally {
    elements.runOcr.disabled = false;
    elements.runOcr.textContent = '開始 OCR 辨識';
  }
}

function importOcrText() {
  const text = elements.ocrText.value.trim();
  if (!text) {
    addBotMessage('OCR 文字是空的，請先辨識圖片或貼上單據內容。');
    return;
  }
  const parsed = parseReceiptText(text);
  if (!parsed.length) {
    addBotMessage('沒有從單據內容找到可記錄的金額。');
    return;
  }
  addExpenses(parsed);
  addBotMessage(`已從單據匯入 ${parsed.length} 筆帳目，共 ${formatCurrency(parsed.reduce((sum, item) => sum + item.amount, 0))}。`);
}

function addExpenses(expenses) {
  state.expenses = [...expenses, ...state.expenses];
  saveExpenses();
  render();
}

function render() {
  renderDashboard();
  renderTable();
  renderReport();
}

function renderDashboard() {
  const now = elements.reportDate.value || toISODate(new Date());
  const today = buildReport(state.expenses, 'day', now);
  const week = buildReport(state.expenses, 'week', now);
  const month = buildReport(state.expenses, 'month', now);
  elements.todayTotal.textContent = formatCurrency(today.total);
  elements.weekTotal.textContent = formatCurrency(week.total);
  elements.monthTotal.textContent = formatCurrency(month.total);
  elements.topCategory.textContent = month.topCategory ? `${month.topCategory.name} ${formatCurrency(month.topCategory.amount)}` : '尚無資料';
}

function renderTable() {
  elements.table.innerHTML = '';
  if (!state.expenses.length) {
    elements.table.innerHTML = '<tr><td colspan="6" class="empty">尚未建立帳目</td></tr>';
    return;
  }
  state.expenses
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .forEach((expense) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(expense.date)}</td>
        <td>${escapeHtml(expense.item)}</td>
        <td><span class="category">${escapeHtml(expense.category)}</span></td>
        <td>${formatCurrency(expense.amount)}</td>
        <td>${escapeHtml(expense.note || '')}</td>
        <td><button class="icon-button" type="button" aria-label="刪除 ${escapeHtml(expense.item)}" data-id="${expense.id}">×</button></td>
      `;
      row.querySelector('button').addEventListener('click', () => deleteExpense(expense.id));
      elements.table.appendChild(row);
    });
}

function renderReport() {
  const report = currentReport();
  const categoryItems = Object.entries(report.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => `<li><span>${escapeHtml(category)}</span><strong>${formatCurrency(amount)}</strong></li>`)
    .join('');

  elements.reportSummary.innerHTML = `
    <h3>${periodLabel(report.period)}報告</h3>
    <p>${report.range.start} 至 ${report.range.end}</p>
    <div class="total-box">${formatCurrency(report.total)}</div>
    <p>共 ${report.expenses.length} 筆消費</p>
    <h4>類別排行</h4>
    <ul>${categoryItems || '<li><span>尚無資料</span><strong>$0</strong></li>'}</ul>
  `;
}

function currentReport() {
  return buildReport(state.expenses, elements.reportPeriod.value, elements.reportDate.value || new Date());
}

function downloadReport(type) {
  const report = currentReport();
  const basename = `expense-${report.period}-${report.range.start}-${report.range.end}`;
  if (type === 'csv') {
    downloadBlob(`${basename}.csv`, `\uFEFF${toCsv(report)}`, 'text/csv;charset=utf-8');
    return;
  }
  downloadBlob(`${basename}.pdf`, createPdfDocument(report), 'application/pdf');
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

function deleteExpense(id) {
  state.expenses = state.expenses.filter((expense) => expense.id !== id);
  saveExpenses();
  render();
}

function seedDemoData() {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  addExpenses([
    ...parseExpenseText(`今天 午餐 135，咖啡 80`, today),
    ...parseExpenseText(`昨天 捷運交通 45，超市購物 620`, yesterday),
    ...parseExpenseText(`${toISODate(today)} 電影票 320`, today)
  ]);
}

function clearData() {
  state.expenses = [];
  saveExpenses();
  render();
  addBotMessage('已清除本機帳目資料。');
}

function addUserMessage(text) {
  addMessage(text, 'user');
}

function addBotMessage(text) {
  addMessage(text, 'bot');
}

function addMessage(text, sender) {
  const node = elements.messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(sender);
  node.querySelector('.avatar').textContent = sender === 'user' ? '你' : 'AI';
  node.querySelector('.bubble').textContent = text;
  elements.messages.appendChild(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function periodLabel(period) {
  return { day: '每日', week: '每週', month: '每月' }[period] || '自訂';
}

function loadExpenses() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveExpenses() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.expenses));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}
