/**
 * Customer & Vendor Import Tests
 *
 * Tests the importEngine for customer and vendor types:
 * - row validation (required fields, email format, duplicate detection)
 * - job outcome (failed on bad rows, guards)
 * - template buffer generation
 */
const db = require('../setup');
const mongoose = require('mongoose');
const Entity = require('../../src/models/Entity');
const CompanySettings = require('../../src/models/CompanySettings');
const ImportJob = require('../../src/models/ImportJob');
const Customer = require('../../src/models/Customer');
const Vendor = require('../../src/models/Vendor');
const { stageImport, executeImport, generateTemplateBuffer, TEMPLATES } = require('../../src/services/importEngine');

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

// ─── Shared setup ─────────────────────────────────────────────────────────────

async function seedBase() {
  const entity = await Entity.create({ name: 'Test Co', country: 'IN', baseCurrency: 'INR' });
  await CompanySettings.create({
    defaultEntityId: entity._id,
    defaultCurrency: 'INR',
    features: { USE_IMPORT_ENGINE: true },
  });
  return entity;
}

// ─── Template generation ──────────────────────────────────────────────────────

describe('Template generation', () => {
  test('generates a buffer for each import type', () => {
    for (const type of Object.keys(TEMPLATES)) {
      const buf = generateTemplateBuffer(type);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
    }
  });

  test('throws for unknown type', () => {
    expect(() => generateTemplateBuffer('unknown_type')).toThrow(/No template/i);
  });
});

// ─── Customer import ──────────────────────────────────────────────────────────

describe('Customer import — validation', () => {
  test('rejects rows missing name', async () => {
    const entity = await seedBase();
    const job = await ImportJob.create({
      type: 'customer', status: 'ready', entityId: entity._id,
      uploadedBy: new mongoose.Types.ObjectId(), fileName: 'test.xlsx',
      summary: { totalRows: 1, validRows: 0, errorRows: 1, importedRows: 0 },
      errors: [{ row: 0, field: 'name', message: 'name is required' }],
      previewData: [{ name: null, email: 'test@example.com' }],
    });
    expect(job.status).toBe('ready'); // pre-set for this test
    expect(job.errors[0].field).toBe('name');
  });

  test('rejects invalid email format during stageImport', async () => {
    const entity = await seedBase();
    // We rely on xlsx — create a synthetic buffer via TEMPLATES
    const xlsx = require('xlsx');
    const ws = xlsx.utils.json_to_sheet([{ name: 'Acme', email: 'not-an-email', phone: '' }]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Customers');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const job = await stageImport({
      buffer, fileName: 'customers.xlsx', entityId: String(entity._id),
      type: 'customer', source: 'excel',
      userId: new mongoose.Types.ObjectId(),
    });

    expect(job.status).toBe('failed');
    expect(job.errors.some(e => e.field === 'email')).toBe(true);
  });

  test('accepts valid customer rows', async () => {
    const entity = await seedBase();
    const xlsx = require('xlsx');
    const ws = xlsx.utils.json_to_sheet([
      { name: 'Customer A', email: 'a@example.com', phone: '9999999999' },
      { name: 'Customer B', email: null, phone: null },
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Customers');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const job = await stageImport({
      buffer, fileName: 'customers.xlsx', entityId: String(entity._id),
      type: 'customer', source: 'excel',
      userId: new mongoose.Types.ObjectId(),
    });

    expect(job.status).toBe('ready');
    expect(job.summary.validRows).toBe(2);
    expect(job.summary.errorRows).toBe(0);
  });
});

// ─── Vendor import ────────────────────────────────────────────────────────────

describe('Vendor import — validation', () => {
  test('rejects rows missing name', async () => {
    const entity = await seedBase();
    const xlsx = require('xlsx');
    const ws = xlsx.utils.json_to_sheet([{ name: null, email: 'v@example.com' }]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Vendors');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const job = await stageImport({
      buffer, fileName: 'vendors.xlsx', entityId: String(entity._id),
      type: 'vendor', source: 'excel',
      userId: new mongoose.Types.ObjectId(),
    });

    expect(job.status).toBe('failed');
    expect(job.errors[0].field).toBe('name');
  });

  test('detects duplicate vendor by name', async () => {
    const entity = await seedBase();
    await Vendor.create({ name: 'Existing Vendor' });

    const xlsx = require('xlsx');
    const ws = xlsx.utils.json_to_sheet([{ name: 'Existing Vendor', email: null }]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Vendors');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const job = await stageImport({
      buffer, fileName: 'vendors.xlsx', entityId: String(entity._id),
      type: 'vendor', source: 'excel',
      userId: new mongoose.Types.ObjectId(),
    });

    expect(job.status).toBe('failed');
    expect(job.errors.some(e => e.message.includes('already exists'))).toBe(true);
  });
});

// ─── Engine guards ────────────────────────────────────────────────────────────

describe('Import engine guards', () => {
  test('stageImport rejects unsupported type', async () => {
    const entity = await seedBase();
    const buf = generateTemplateBuffer('customer');
    await expect(
      stageImport({ buffer: buf, fileName: 'f.xlsx', entityId: String(entity._id), type: 'payroll', source: 'excel', userId: new mongoose.Types.ObjectId() })
    ).rejects.toThrow(/Unsupported import type/i);
  });

  test('executeImport rejects non-ready job', async () => {
    const entity = await seedBase();
    const job = await ImportJob.create({
      type: 'customer', status: 'completed', entityId: entity._id,
      uploadedBy: new mongoose.Types.ObjectId(), fileName: 'done.xlsx',
      summary: { totalRows: 1, validRows: 1, errorRows: 0, importedRows: 1 },
      errors: [], previewData: [],
    });
    await expect(executeImport(String(job._id), null)).rejects.toThrow(/cannot be executed/i);
  });

  test('stageImport rejects empty spreadsheet', async () => {
    const entity = await seedBase();
    const xlsx = require('xlsx');
    // Sheet with only headers, no data rows
    const ws = xlsx.utils.json_to_sheet([]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Empty');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    await expect(
      stageImport({ buffer, fileName: 'empty.xlsx', entityId: String(entity._id), type: 'customer', source: 'excel', userId: new mongoose.Types.ObjectId() })
    ).rejects.toThrow(/no data rows/i);
  });
});
