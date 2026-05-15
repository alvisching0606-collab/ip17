export const CATEGORY_KEYWORDS = {
  餐飲: ['午餐', '晚餐', '早餐', '咖啡', '餐', '飲料', '便當', '麵', 'food', 'coffee', 'restaurant'],
  交通: ['交通', '捷運', '地鐵', '巴士', '公車', '計程車', 'uber', 'taxi', '停車', '加油'],
  購物: ['購物', '超市', '商店', '便利店', '全聯', '家樂福', 'costco', 'market', 'store'],
  娛樂: ['電影', '遊戲', '娛樂', 'netflix', 'spotify', '票'],
  住宿: ['飯店', '酒店', '旅館', 'hotel', 'airbnb'],
  醫療: ['藥', '診所', '醫院', '醫療', 'pharmacy'],
  其他: []
};

const MONEY_PATTERN = /(?:[$＄NTD\s]*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g;
const DATE_PATTERN = /(今天|昨日|昨天|前天|\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2})/;

export function formatCurrency(amount) {
  return new Intl.NumberFormat('zh-Hant', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0
  }).format(amount || 0);
}

export function toISODate(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function resolveDate(text = '', baseDate = new Date()) {
  const match = text.match(DATE_PATTERN);
  const base = new Date(baseDate);
  if (!match) return toISODate(base);

  const token = match[1];
  if (token === '昨天' || token === '昨日') {
    base.setDate(base.getDate() - 1);
    return toISODate(base);
  }
  if (token === '前天') {
    base.setDate(base.getDate() - 2);
    return toISODate(base);
  }
  if (token === '今天') return toISODate(base);

  const parts = token.split(/[/-]/).map(Number);
  if (parts.length === 3) {
    return toISODate(new Date(parts[0], parts[1] - 1, parts[2]));
  }
  return toISODate(new Date(base.getFullYear(), parts[0] - 1, parts[1]));
}

export function inferCategory(text = '') {
  const normalized = text.toLowerCase();
  return (
    Object.entries(CATEGORY_KEYWORDS).find(([category, keywords]) => {
      return category !== '其他' && keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
    })?.[0] || '其他'
  );
}

export function extractAmounts(text = '') {
  return [...text.matchAll(MONEY_PATTERN)]
    .map((match) => Number(match[1].replaceAll(',', '')))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
}

export function parseExpenseText(text = '', baseDate = new Date()) {
  const normalized = text.replace(/[，。；;\n]+/g, '|');
  const fragments = normalized
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);

  const candidates = fragments.length ? fragments : [text];
  const expenses = [];

  for (const fragment of candidates) {
    const amounts = extractAmounts(fragment);
    if (!amounts.length) continue;

    const amount = chooseLikelyAmount(fragment, amounts);
    const item = cleanupItemName(fragment) || inferCategory(fragment);
    expenses.push({
      id: cryptoRandomId(),
      date: resolveDate(fragment, baseDate),
      item,
      category: inferCategory(fragment),
      amount,
      note: fragment,
      source: 'text',
      createdAt: new Date().toISOString()
    });
  }

  return expenses;
}

export function parseReceiptText(text = '', baseDate = new Date()) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fullText = lines.join(' ');
  const totalLine = lines.find((line) => /總計|合計|total|amount|應付|付款/i.test(line));
  const amounts = extractAmounts(totalLine || fullText);
  const amount = amounts.length ? Math.max(...amounts) : 0;
  if (!amount) return parseExpenseText(text, baseDate).map((expense) => ({ ...expense, source: 'ocr' }));

  const merchant = lines.find((line) => !extractAmounts(line).length && line.length >= 2)?.slice(0, 40) || '單據消費';
  return [
    {
      id: cryptoRandomId(),
      date: resolveDate(fullText, baseDate),
      item: merchant,
      category: inferCategory(fullText),
      amount,
      note: fullText.slice(0, 160),
      source: 'ocr',
      createdAt: new Date().toISOString()
    }
  ];
}

export function buildReport(expenses, period, anchorDate = new Date()) {
  const range = getDateRange(period, anchorDate);
  const filtered = expenses
    .filter((expense) => expense.date >= range.start && expense.date <= range.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.item.localeCompare(b.item));
  const total = filtered.reduce((sum, expense) => sum + Number(expense.amount), 0);
  const byCategory = filtered.reduce((acc, expense) => {
    acc[expense.category] = (acc[expense.category] || 0) + Number(expense.amount);
    return acc;
  }, {});
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0];

  return {
    period,
    range,
    expenses: filtered,
    total,
    byCategory,
    topCategory: topCategory ? { name: topCategory[0], amount: topCategory[1] } : null
  };
}

export function getDateRange(period, anchorDate = new Date()) {
  const anchor = new Date(anchorDate);
  const start = new Date(anchor);
  const end = new Date(anchor);

  if (period === 'week') {
    const day = (anchor.getDay() + 6) % 7;
    start.setDate(anchor.getDate() - day);
    end.setDate(start.getDate() + 6);
  } else if (period === 'month') {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
  }

  return { start: toISODate(start), end: toISODate(end) };
}

export function toCsv(report) {
  const rows = [['日期', '項目', '類別', '金額', '備註']].concat(
    report.expenses.map((expense) => [expense.date, expense.item, expense.category, expense.amount, expense.note])
  );
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function createPdfDocument(report) {
  const title = `Expense Report ${report.range.start} to ${report.range.end}`;
  const lines = [
    title,
    `Total: ${report.total}`,
    `Top category: ${report.topCategory ? `${report.topCategory.name} ${report.topCategory.amount}` : 'N/A'}`,
    '',
    'Date | Item | Category | Amount',
    ...report.expenses.map((expense) => `${expense.date} | ${expense.item} | ${expense.category} | ${expense.amount}`)
  ];

  const stream = buildPdfTextStream(lines);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function buildPdfTextStream(lines) {
  const content = ['BT', '/F1 13 Tf', '50 790 Td'];
  lines.slice(0, 42).forEach((line, index) => {
    if (index > 0) content.push('0 -18 Td');
    content.push(`(${sanitizePdfText(line)}) Tj`);
  });
  content.push('ET');
  return content.join('\n');
}

function sanitizePdfText(value) {
  return String(value)
    .replace(/[\u0080-\uFFFF]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function escapeCsvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function chooseLikelyAmount(fragment, amounts) {
  if (/總計|合計|total|amount|應付|付款/i.test(fragment)) return Math.max(...amounts);
  return amounts.at(-1);
}

function cleanupItemName(fragment) {
  return fragment
    .replace(DATE_PATTERN, '')
    .replace(MONEY_PATTERN, '')
    .replace(/(花了|消費|付款|支出|元|塊|台幣|NTD|TWD|：|:)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function cryptoRandomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `exp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
