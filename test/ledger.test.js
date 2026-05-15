import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport,
  createPdfDocument,
  parseExpenseText,
  parseReceiptText,
  toCsv,
  detectPaymentMethod,
  learnFromReceiptConfirmation,
  parseReceiptConfirmationReply
} from '../src/ledger.js';

const baseDate = new Date('2026-05-15T12:00:00Z');

test('parses multiple natural-language expenses', () => {
  const expenses = parseExpenseText('昨天 午餐 120；今天 捷運交通 45', baseDate);
  assert.equal(expenses.length, 2);
  assert.equal(expenses[0].date, '2026-05-14');
  assert.equal(expenses[0].category, '餐飲');
  assert.equal(expenses[0].amount, 120);
  assert.equal(expenses[1].category, '交通');
});

test('parses OCR receipt text using total line', () => {
  const expenses = parseReceiptText('咖啡店\n拿鐵 90\n蛋糕 120\nTotal 210', baseDate);
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].item, '咖啡店');
  assert.equal(expenses[0].amount, 210);
  assert.equal(expenses[0].source, 'ocr');
});

test('prefers receipt silver amount and cash/card payment lines over unrelated large numbers', () => {
  const receipt = [
    '香港便利店',
    '發票 Invoice 987654321',
    '卡號 **** **** **** 1234',
    'VISA 350.00',
    '找續 Change 650.00'
  ].join('\n');
  const expenses = parseReceiptText(receipt, baseDate);
  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].amount, 350);
  assert.equal(expenses[0].paymentMethod, 'VISA');

  const cashReceipt = parseReceiptText('店鋪\n銀碼 金額 現金 350.00\n參考編號 999999', baseDate);
  assert.equal(cashReceipt[0].amount, 350);
  assert.equal(cashReceipt[0].paymentMethod, '現金');
});

test('detects Hong Kong, Taiwan, and Mainland China payment methods', () => {
  assert.equal(detectPaymentMethod('八達通 Octopus 銀碼 42.50'), '八達通');
  assert.equal(detectPaymentMethod('LINE Pay 金額 180'), 'LINE Pay');
  assert.equal(detectPaymentMethod('微信支付 RMB 88.00'), '微信支付');
  assert.equal(detectPaymentMethod('MASTER 金額 350.00'), 'MASTER');
});



test('parses user confirmation corrections and learns merchant/payment preferences', () => {
  const receiptText = 'ABC SHOP\n銀碼 350.00\nVISA';
  const [original] = parseReceiptText(receiptText, baseDate);
  const reply = parseReceiptConfirmationReply('日期 2026/05/13，商戶 7-Eleven，金額 320.50，支付方式 現金，類別 餐飲', original, baseDate);

  assert.equal(reply.hasUpdates, true);
  assert.equal(reply.expense.date, '2026-05-13');
  assert.equal(reply.expense.item, '7-Eleven');
  assert.equal(reply.expense.amount, 320.5);
  assert.equal(reply.expense.paymentMethod, '現金');

  const learned = learnFromReceiptConfirmation({}, receiptText, original, reply.expense);
  const [reparsed] = parseReceiptText(receiptText, baseDate, learned);
  assert.equal(reparsed.item, '7-Eleven');
  assert.equal(reparsed.paymentMethod, '現金');
});

test('builds monthly report and CSV export', () => {
  const expenses = parseExpenseText('2026/05/01 午餐 100；2026/05/15 超市購物 300；2026/04/30 交通 50', baseDate);
  const report = buildReport(expenses, 'month', baseDate);
  assert.equal(report.expenses.length, 2);
  assert.equal(report.total, 400);
  assert.equal(report.topCategory.name, '購物');
  const csv = toCsv(report);
  assert.match(csv, /日期,項目,類別,支付方式,金額,備註/);
  assert.match(csv, /2026-05-15/);
});

test('creates a downloadable PDF payload', () => {
  const report = buildReport(parseExpenseText('今天 午餐 120', baseDate), 'day', baseDate);
  const pdf = createPdfDocument(report);
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /Expense Report/);
  assert.match(pdf, /%%EOF$/);
});
