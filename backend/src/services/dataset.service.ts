import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../utils/AppError';

export type DatasetValue = string | number | boolean | null;
export type DatasetRow = Record<string, DatasetValue>;

export const MAX_DATASET_ROWS = 1000;
export const MAX_DATASET_COLUMNS = 50;
const MAX_CELL_LENGTH = 5000;
const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export interface ParsedDataset { columns: string[]; rows: DatasetRow[]; }

export interface DatasetSummaryDto {
  id: string; projectId: string; name: string; format: string; columns: string[];
  rowCount: number; createdBy: string; createdAt: Date; updatedAt: Date; usedByTestCases: number;
}
export interface DatasetDetailDto extends DatasetSummaryDto { rows: DatasetRow[]; }

/** RFC 4180-style CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const delimiter = detectDelimiter(input);
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === delimiter) { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (quoted) throw new AppError('File CSV có dấu ngoặc kép chưa được đóng', 400, true, 'INVALID_CSV');
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) { best = candidate; bestCount = count; }
  }
  return best;
}

function coerceCsvValue(raw: string): DatasetValue {
  const value = raw.trim();
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  // Only coerce "clean" numbers; keep values like "0123" (phone numbers, zip codes) as strings.
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(value)) return Number(value);
  return raw;
}

function validateColumns(columns: string[]): string[] {
  const cleaned = columns.map((column) => column.trim());
  if (cleaned.length === 0) throw new AppError('Bộ dữ liệu cần ít nhất một cột', 400, true, 'INVALID_DATASET');
  if (cleaned.length > MAX_DATASET_COLUMNS) throw new AppError(`Tối đa ${MAX_DATASET_COLUMNS} cột`, 400, true, 'INVALID_DATASET');
  const seen = new Set<string>();
  for (const column of cleaned) {
    if (!COLUMN_NAME.test(column)) throw new AppError(`Tên cột "${column}" không hợp lệ. Chỉ dùng chữ, số, _ . - và bắt đầu bằng chữ cái`, 400, true, 'INVALID_DATASET');
    if (seen.has(column)) throw new AppError(`Tên cột "${column}" bị trùng`, 400, true, 'INVALID_DATASET');
    seen.add(column);
  }
  return cleaned;
}

function normalizeCell(value: unknown): DatasetValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length > MAX_CELL_LENGTH) throw new AppError(`Giá trị ô vượt quá ${MAX_CELL_LENGTH} ký tự`, 400, true, 'INVALID_DATASET');
  return text;
}

export function parseDatasetContent(format: 'csv' | 'json', content: string): ParsedDataset {
  if (format === 'csv') {
    const table = parseCsv(content);
    if (table.length < 2) throw new AppError('File CSV cần dòng tiêu đề và ít nhất một dòng dữ liệu', 400, true, 'INVALID_CSV');
    const columns = validateColumns(table[0]);
    const dataRows = table.slice(1);
    if (dataRows.length > MAX_DATASET_ROWS) throw new AppError(`Tối đa ${MAX_DATASET_ROWS} dòng dữ liệu`, 400, true, 'INVALID_DATASET');
    const rows = dataRows.map((cells, index) => {
      if (cells.length > columns.length) throw new AppError(`Dòng ${index + 2} có ${cells.length} cột, nhiều hơn tiêu đề (${columns.length})`, 400, true, 'INVALID_CSV');
      const row: DatasetRow = {};
      columns.forEach((column, columnIndex) => { row[column] = normalizeCell(coerceCsvValue(cells[columnIndex] ?? '')); });
      return row;
    });
    return { columns, rows };
  }

  let parsed: unknown;
  try { parsed = JSON.parse(content.replace(/^﻿/, '')); }
  catch { throw new AppError('File JSON không hợp lệ', 400, true, 'INVALID_JSON'); }
  const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data) ? (parsed as { data: unknown[] }).data : null);
  if (!list) throw new AppError('File JSON phải là một mảng đối tượng, ví dụ [{"email":"a@x.com"}]', 400, true, 'INVALID_JSON');
  if (list.length === 0) throw new AppError('Mảng dữ liệu đang rỗng', 400, true, 'INVALID_DATASET');
  if (list.length > MAX_DATASET_ROWS) throw new AppError(`Tối đa ${MAX_DATASET_ROWS} dòng dữ liệu`, 400, true, 'INVALID_DATASET');
  const columnSet = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AppError('Mỗi phần tử trong mảng phải là một đối tượng', 400, true, 'INVALID_JSON');
    Object.keys(item as Record<string, unknown>).forEach((key) => columnSet.add(key));
  }
  const columns = validateColumns([...columnSet]);
  const rows = list.map((item) => {
    const record = item as Record<string, unknown>;
    const row: DatasetRow = {};
    columns.forEach((column) => { row[column] = normalizeCell(record[column]); });
    return row;
  });
  return { columns, rows };
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;

/**
 * Replaces {{column}} placeholders. A string that is *only* a placeholder keeps the
 * cell's original type (number/boolean); otherwise the value is interpolated as text.
 */
export function applyDatasetRow<T>(value: T, row: DatasetRow): T {
  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const whole = WHOLE_PLACEHOLDER.exec(node);
      if (whole && Object.prototype.hasOwnProperty.call(row, whole[1])) return row[whole[1]];
      return node.replace(PLACEHOLDER, (match, key: string) => (Object.prototype.hasOwnProperty.call(row, key) ? String(row[key] ?? '') : match));
    }
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([key, item]) => [key, visit(item)]));
    return node;
  };
  return visit(value) as T;
}

export function parseStoredRows(value: unknown): DatasetRow[] {
  return Array.isArray(value) ? value.filter((row): row is DatasetRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row)) : [];
}

function summary(row: { id: string; projectId: string; name: string; format: string; columns: Prisma.JsonValue; rowCount: number; createdBy: string; createdAt: Date; updatedAt: Date; _count?: { testCases: number } }): DatasetSummaryDto {
  return {
    id: row.id, projectId: row.projectId, name: row.name, format: row.format,
    columns: Array.isArray(row.columns) ? row.columns.filter((item): item is string => typeof item === 'string') : [],
    rowCount: row.rowCount, createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt,
    usedByTestCases: row._count?.testCases ?? 0,
  };
}

export class DatasetService {
  async list(projectId: string): Promise<DatasetSummaryDto[]> {
    const rows = await prisma.testDataset.findMany({
      where: { projectId }, orderBy: { createdAt: 'desc' },
      select: { id: true, projectId: true, name: true, format: true, columns: true, rowCount: true, createdBy: true, createdAt: true, updatedAt: true, _count: { select: { testCases: true } } },
    });
    return rows.map(summary);
  }

  async get(datasetId: string): Promise<DatasetDetailDto> {
    const row = await prisma.testDataset.findUnique({ where: { id: datasetId }, include: { _count: { select: { testCases: true } } } });
    if (!row) throw new AppError('Không tìm thấy bộ dữ liệu', 404, true, 'DATASET_NOT_FOUND');
    return { ...summary(row), rows: parseStoredRows(row.rows) };
  }

  async create(projectId: string, userId: string, input: { name: string; format: 'csv' | 'json'; content: string }): Promise<DatasetDetailDto> {
    const parsed = parseDatasetContent(input.format, input.content);
    const row = await prisma.testDataset.create({
      data: {
        projectId, name: input.name.trim(), format: input.format, createdBy: userId,
        columns: parsed.columns, rows: parsed.rows as unknown as Prisma.InputJsonValue, rowCount: parsed.rows.length,
      },
      include: { _count: { select: { testCases: true } } },
    });
    return { ...summary(row), rows: parsed.rows };
  }

  async replaceContent(datasetId: string, input: { name?: string; format?: 'csv' | 'json'; content?: string }): Promise<DatasetDetailDto> {
    const existing = await prisma.testDataset.findUnique({ where: { id: datasetId } });
    if (!existing) throw new AppError('Không tìm thấy bộ dữ liệu', 404, true, 'DATASET_NOT_FOUND');
    const data: Prisma.TestDatasetUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.content !== undefined) {
      const parsed = parseDatasetContent(input.format ?? (existing.format as 'csv' | 'json'), input.content);
      data.columns = parsed.columns;
      data.rows = parsed.rows as unknown as Prisma.InputJsonValue;
      data.rowCount = parsed.rows.length;
      if (input.format) data.format = input.format;
    }
    await prisma.testDataset.update({ where: { id: datasetId }, data });
    return this.get(datasetId);
  }

  async delete(datasetId: string): Promise<void> {
    await prisma.testDataset.delete({ where: { id: datasetId } });
  }

  async projectIdOf(datasetId: string): Promise<string> {
    const row = await prisma.testDataset.findUnique({ where: { id: datasetId }, select: { projectId: true } });
    if (!row) throw new AppError('Không tìm thấy bộ dữ liệu', 404, true, 'DATASET_NOT_FOUND');
    return row.projectId;
  }
}

export const datasetService = new DatasetService();
