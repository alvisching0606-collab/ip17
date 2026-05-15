import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReport,
  createPdfDocument,
  parseExpenseText,
  parseReceiptText,
  toCsv
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

test('builds monthly report and CSV export', () => {
  const expenses = parseExpenseText('2026/05/01 午餐 100；2026/05/15 超市購物 300；2026/04/30 交通 50', baseDate);
  const report = buildReport(expenses, 'month', baseDate);
  assert.equal(report.expenses.length, 2);
  assert.equal(report.total, 400);
  assert.equal(report.topCategory.name, '購物');
  const csv = toCsv(report);
  assert.match(csv, /日期,項目,類別,金額,備註/);
  assert.match(csv, /2026-05-15/);
});

test('creates a downloadable PDF payload', () => {
  const report = buildReport(parseExpenseText('今天 午餐 120', baseDate), 'day', baseDate);
  const pdf = createPdfDocument(report);
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /Expense Report/);
  assert.match(pdf, /%%EOF$/);
});
