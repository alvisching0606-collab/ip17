export const CATEGORY_KEYWORDS = {
  餐飲: ['午餐', '晚餐', '早餐', '咖啡', '餐', '飲料', '便當', '麵', 'food', 'coffee', 'restaurant'],
  交通: ['交通', '捷運', '地鐵', '巴士', '公車', '計程車', 'uber', 'taxi', '停車', '加油'],
  購物: ['購物', '超市', '商店', '便利店', '全聯', '家樂福', 'costco', 'market', 'store'],
  娛樂: ['電影', '電影票', '演唱會', '遊戲', '娛樂', 'netflix', 'spotify'],
  住宿: ['飯店', '酒店', '旅館', 'hotel', 'airbnb'],
  醫療: ['藥', '診所', '醫院', '醫療', 'pharmacy'],
  其他: []
};

const MONEY_PATTERN = /(?:HK\$|NT\$|RMB|CNY|TWD|HKD|NTD|[$＄¥￥])?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/gi;
const RECEIPT_MONEY_PATTERN = /(?:HK\$|NT\$|RMB|CNY|TWD|HKD|NTD|[$＄¥￥])?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/gi;
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
    .map((match) => Number(match[1].replaceAll(',', '') + (match[2] || '')))
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
  const lines = normalizeReceiptText(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fullText = lines.join(' ');
  const amountCandidate = findReceiptAmountCandidate(lines);
  const amount = amountCandidate?.amount || 0;
  if (!amount) return parseExpenseText(text, baseDate).map((expense) => ({ ...expense, source: 'ocr' }));

  const merchant = lines.find((line) => !extractAmounts(line).length && line.length >= 2 && !isReceiptMetadataLine(line))?.slice(0, 40) || '單據消費';
  const paymentMethod = detectPaymentMethod(fullText);
  return [
    {
      id: cryptoRandomId(),
      date: resolveDate(fullText, baseDate),
      item: merchant,
      category: inferCategory(fullText),
      amount,
      paymentMethod,
      note: buildReceiptNote(fullText, amountCandidate, paymentMethod),
      source: 'ocr',
      createdAt: new Date().toISOString()
    }
  ];
}


export function detectPaymentMethod(text = '') {
  const normalized = text.toLowerCase();
  const methods = [
    ['VISA', /\bvisa\b|維薩/i],
    ['MASTER', /master\s*card|mastercard|\bmaster\b|萬事達/i],
    ['銀聯', /union\s*pay|unionpay|銀聯|云閃付|雲閃付/i],
    ['現金', /現金|cash|cash tender|cash payment/i],
    ['八達通', /octopus|八達通/i],
    ['EPS', /\beps\b|易辦事/i],
    ['轉數快', /\bfps\b|轉數快|快速支付/i],
    ['PayMe', /payme/i],
    ['AlipayHK', /alipayhk|支付寶香港/i],
    ['支付寶', /alipay|支付寶/i],
    ['微信支付', /wechat\s*pay|weixin\s*pay|微信支付/i],
    ['悠遊卡', /easycard|悠遊卡/i],
    ['一卡通', /ipass|一卡通/i],
    ['LINE Pay', /line\s*pay/i],
    ['街口支付', /jko|街口/i],
    ['台灣Pay', /taiwan\s*pay|台灣pay|臺灣pay/i],
    ['Apple Pay', /apple\s*pay/i],
    ['Google Pay', /google\s*pay/i],
    ['信用卡', /信用卡|credit\s*card|card payment|刷卡/i],
    ['電子錢包', /電子錢包|e-?wallet|wallet/i]
  ];
  return methods.find(([, pattern]) => pattern.test(normalized))?.[0] || '';
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
  const rows = [['日期', '項目', '類別', '支付方式', '金額', '備註']].concat(
    report.expenses.map((expense) => [expense.date, expense.item, expense.category, expense.paymentMethod || '', expense.amount, expense.note])
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
    'Date | Item | Category | Payment | Amount',
    ...report.expenses.map((expense) => `${expense.date} | ${expense.item} | ${expense.category} | ${expense.paymentMethod || '-'} | ${expense.amount}`)
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


function normalizeReceiptText(text) {
  return String(text || '')
    .replace(/[：]/g, ':')
    .replace(/[，]/g, ',')
    .replace(/[．]/g, '.')
    .replace(/[＄]/g, '$')
    .replace(/[￥]/g, '¥')
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function findReceiptAmountCandidate(lines) {
  const candidates = lines.flatMap((line, lineIndex) => {
    return extractReceiptLineAmounts(line).map((candidate) => ({
      ...candidate,
      line,
      lineIndex,
      score: scoreReceiptAmountCandidate(line, candidate)
    }));
  });

  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.score - a.score || b.hasDecimal - a.hasDecimal || b.amount - a.amount)[0];
}

function extractReceiptLineAmounts(line) {
  return [...line.matchAll(RECEIPT_MONEY_PATTERN)]
    .map((match) => ({
      raw: match[0],
      amount: Number(match[1].replaceAll(',', '') + (match[2] || '')),
      hasDecimal: Boolean(match[2]),
      index: match.index || 0
    }))
    .filter((candidate) => Number.isFinite(candidate.amount) && candidate.amount > 0);
}

function scoreReceiptAmountCandidate(line, candidate) {
  const lower = line.toLowerCase();
  let score = Math.min(candidate.amount, 1000);

  if (/銀碼|金額|總計|合計|總額|應付|實付|已付|付款|收款|消費金額|交易金額|amount|total|grand total|sale amount|paid/i.test(line)) score += 10000;
  if (/現金|cash|visa|master|mastercard|unionpay|銀聯|octopus|八達通|eps|轉數快|fps|payme|alipay|支付寶|wechat|微信|悠遊卡|easycard|一卡通|line pay|街口|jko|台灣pay|taiwan pay|apple pay|google pay/i.test(line)) score += 9000;
  if (candidate.hasDecimal) score += 1500;
  if (candidate.index > line.length * 0.45) score += 600;

  if (/找續|找零|找贖|change|退款|refund|退貨/i.test(line)) score -= 12000;
  if (/折扣|優惠|discount|coupon|稅|tax|小計|subtotal|服務費|service charge/i.test(line)) score -= 6000;
  if (/卡號|card no|card number|授權|auth|approval|批核|參考|reference|ref|流水|發票|invoice|單號|terminal|merchant id/i.test(lower)) score -= 10000;
  if (!candidate.hasDecimal && candidate.amount >= 1000 && /[＊*xX]{2,}|尾號|末四碼|ending/i.test(line)) score -= 15000;
  if (/\d{1,2}:\d{2}|\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(candidate.raw)) score -= 8000;

  return score;
}

function isReceiptMetadataLine(line) {
  return /銀碼|金額|總計|合計|應付|付款|現金|visa|master|octopus|八達通|支付寶|微信|日期|時間|發票|單號|terminal|merchant id/i.test(line);
}

function buildReceiptNote(fullText, amountCandidate, paymentMethod) {
  const parts = [];
  if (paymentMethod) parts.push(`支付方式: ${paymentMethod}`);
  if (amountCandidate?.line) parts.push(`金額來源: ${amountCandidate.line}`);
  parts.push(fullText.slice(0, 160));
  return parts.join(' | ').slice(0, 240);
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
