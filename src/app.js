import {
  buildReport,
  createPdfDocument,
  formatCurrency,
  learnFromReceiptConfirmation,
  parseExpenseText,
  parseReceiptConfirmationReply,
  parseReceiptText,
  toCsv,
  toISODate
} from './ledger.js';

const STORAGE_KEY = 'expense-chatbot-ledger-v1';
const OCR_LEARNING_KEY = 'expense-chatbot-ocr-learning-v1';
const $ = (selector) => document.querySelector(selector);

const state = {
  expenses: loadExpenses(),
  learningProfile: loadOcrLearningProfile(),
  selectedImage: null,
  selectedImageUrl: '',
  pendingReceipt: null
};

const elements = {
  messages: $('#messages'),
  messageTemplate: $('#message-template'),
  chatForm: $('#chat-form'),
  chatInput: $('#chat-input'),
  chatReceiptFile: $('#chat-receipt-file'),
  attachReceipt: $('#attach-receipt'),
  composerAttachment: $('#composer-attachment'),
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
  elements.chatReceiptFile.addEventListener('change', (event) => handleFile(event.target.files?.[0]));
  elements.attachReceipt.addEventListener('click', () => elements.chatReceiptFile.click());
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

async function handleChatSubmit(event) {
  event.preventDefault();
  const text = elements.chatInput.value.trim();
  const hasReceiptAttachment = Boolean(state.selectedImage);
  if (!text && !hasReceiptAttachment) return;

  if (state.pendingReceipt) {
    addUserMessage(text);
    elements.chatInput.value = '';
    handleReceiptConfirmationReply(text);
    return;
  }

  if (hasReceiptAttachment) {
    addUserMessage(text || `上傳單據：${state.selectedImage.name}`, { imageUrl: state.selectedImageUrl });
    elements.chatInput.value = '';
    await processSelectedReceipt(text);
    return;
  }

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
  clearSelectedImage();
  state.selectedImage = file;
  state.selectedImageUrl = URL.createObjectURL(file);
  elements.receiptPreview.src = state.selectedImageUrl;
  elements.receiptPreview.hidden = false;
  renderComposerAttachment();
  addBotMessage(`已將單據「${file.name}」加入對話框。你可以補充說明後按「送出」，我會 OCR 並請你確認日期、商戶、金額與支付方式。`);
}

async function runOcr() {
  try {
    const text = await recognizeSelectedReceipt();
    if (!text) return;
    elements.ocrText.value = text;
    addBotMessage('OCR 完成。你可以按「送到對話確認」讓我先問你確認，再寫入帳目。');
  } catch (error) {
    addBotMessage(`OCR 失敗：${error.message}。可改用手動貼上文字。`);
  }
}

function importOcrText() {
  const text = elements.ocrText.value.trim();
  if (!text) {
    addBotMessage('OCR 文字是空的，請先辨識圖片或貼上單據內容。');
    return;
  }
  startReceiptConfirmation(text);
}

async function processSelectedReceipt(userContext = '') {
  let text = elements.ocrText.value.trim();
  try {
    if (state.selectedImage) text = await recognizeSelectedReceipt();
  } catch (error) {
    addBotMessage(`OCR 失敗：${error.message}。如果圖片無法辨識，請貼上單據文字。`);
    return;
  }

  const combinedText = [text, userContext].filter(Boolean).join('\n');
  if (!combinedText.trim()) {
    addBotMessage('我還沒有可解析的單據文字。請貼上 OCR 文字或重新上傳圖片。');
    return;
  }
  elements.ocrText.value = text;
  startReceiptConfirmation(combinedText);
  clearSelectedImage();
}

function startReceiptConfirmation(receiptText) {
  const parsed = parseReceiptText(receiptText, new Date(), state.learningProfile);
  if (!parsed.length) {
    addBotMessage('沒有從單據內容找到可記錄的金額。請回覆「金額 350 商戶 XXX 支付方式 VISA」補充資料。');
    return;
  }
  const expense = parsed[0];
  state.pendingReceipt = { rawText: receiptText, original: { ...expense }, expense: { ...expense } };
  addBotMessage(formatReceiptConfirmation(expense));
}

function handleReceiptConfirmationReply(text) {
  const result = parseReceiptConfirmationReply(text, state.pendingReceipt.expense);
  if (result.cancelled) {
    state.pendingReceipt = null;
    addBotMessage('已取消這張單據，不會寫入帳目。');
    return;
  }

  if (result.confirmed) {
    state.learningProfile = learnFromReceiptConfirmation(
      state.learningProfile,
      state.pendingReceipt.rawText,
      state.pendingReceipt.original,
      state.pendingReceipt.expense
    );
    saveOcrLearningProfile();
    addExpenses([state.pendingReceipt.expense]);
    addBotMessage('已確認並寫入帳目；OCR 也已把這次確認結果存入本機學習資料。');
    state.pendingReceipt = null;
    return;
  }

  if (result.hasUpdates) {
    state.pendingReceipt.expense = { ...result.expense, note: appendLearningNote(result.expense.note) };
    state.learningProfile = learnFromReceiptConfirmation(
      state.learningProfile,
      state.pendingReceipt.rawText,
      state.pendingReceipt.original,
      state.pendingReceipt.expense
    );
    saveOcrLearningProfile();
    addBotMessage(`${formatReceiptConfirmation(state.pendingReceipt.expense)}\n我已根據你的修正更新本機 OCR 學習，下次相似單據會優先套用。`);
    return;
  }

  addBotMessage('請回覆「確認」寫入帳目，或用「日期 2026/05/15，商戶 XXX，金額 350.00，支付方式 VISA，類別 餐飲」修正。');
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
    elements.table.innerHTML = '<tr><td colspan="7" class="empty">尚未建立帳目</td></tr>';
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
        <td>${escapeHtml(expense.paymentMethod || '—')}</td>
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

function addUserMessage(text, options = {}) {
  addMessage(text, 'user', options);
}

function addBotMessage(text, options = {}) {
  addMessage(text, 'bot', options);
}

function addMessage(text, sender, options = {}) {
  const node = elements.messageTemplate.content.firstElementChild.cloneNode(true);
  node.classList.add(sender);
  node.querySelector('.avatar').textContent = sender === 'user' ? '你' : 'AI';
  const bubble = node.querySelector('.bubble');
  bubble.textContent = text;
  if (options.imageUrl) {
    const image = document.createElement('img');
    image.className = 'message-image';
    image.src = options.imageUrl;
    image.alt = '上傳的單據預覽';
    bubble.prepend(image);
  }
  elements.messages.appendChild(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}


function formatReceiptConfirmation(expense) {
  return [
    '我已讀取單據，請確認以下資料：',
    `日期：${expense.date}`,
    `商戶：${expense.item}`,
    `金額：${formatCurrency(expense.amount)}`,
    `支付方式：${expense.paymentMethod || '未辨識'}`,
    `類別：${expense.category}`,
    '回覆「確認」即可寫入；若要修正，請回覆例如「日期 2026/05/15，商戶 7-Eleven，金額 350.00，支付方式 VISA」。'
  ].join('\n');
}

function appendLearningNote(note = '') {
  return note.includes('用戶已修正') ? note : `${note} | 用戶已修正並學習`;
}

async function recognizeSelectedReceipt() {
  if (!state.selectedImage) {
    addBotMessage('請先選擇一張單據或付款截圖。');
    return '';
  }
  if (!window.Tesseract) {
    throw new Error('OCR 套件尚未載入；請稍後重試或直接貼上單據文字。');
  }

  elements.runOcr.disabled = true;
  elements.runOcr.textContent = '辨識中...';
  try {
    const result = await window.Tesseract.recognize(state.selectedImage, 'eng+chi_tra+chi_sim', {
      logger(message) {
        if (message.status) elements.runOcr.textContent = `${message.status} ${Math.round((message.progress || 0) * 100)}%`;
      }
    });
    return result.data.text.trim();
  } finally {
    elements.runOcr.disabled = false;
    elements.runOcr.textContent = '開始 OCR 辨識';
  }
}

function renderComposerAttachment() {
  if (!state.selectedImage) {
    elements.composerAttachment.hidden = true;
    elements.composerAttachment.innerHTML = '';
    return;
  }
  elements.composerAttachment.hidden = false;
  elements.composerAttachment.innerHTML = `
    <img src="${state.selectedImageUrl}" alt="待送出的單據" />
    <div><strong>${escapeHtml(state.selectedImage.name)}</strong><span>已附加至對話，按送出後 OCR 並確認。</span></div>
    <button class="icon-button" type="button" aria-label="移除單據">×</button>
  `;
  elements.composerAttachment.querySelector('button').addEventListener('click', clearSelectedImage);
}

function clearSelectedImage() {
  if (state.selectedImageUrl) URL.revokeObjectURL(state.selectedImageUrl);
  state.selectedImage = null;
  state.selectedImageUrl = '';
  if (elements.receiptFile) elements.receiptFile.value = '';
  if (elements.chatReceiptFile) elements.chatReceiptFile.value = '';
  elements.receiptPreview.hidden = true;
  renderComposerAttachment();
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

function loadOcrLearningProfile() {
  try {
    return JSON.parse(localStorage.getItem(OCR_LEARNING_KEY)) || {};
  } catch {
    return {};
  }
}

function saveExpenses() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.expenses));
}

function saveOcrLearningProfile() {
  localStorage.setItem(OCR_LEARNING_KEY, JSON.stringify(state.learningProfile));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}
