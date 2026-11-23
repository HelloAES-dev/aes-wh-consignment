/**
 * Shared, non-secret backend configuration.
 *
 * Required Script Properties:
 * - SPREADSHEET_ID
 * - GOOGLE_CLIENT_ID
 * - WITHDRAWAL_PHOTO_FOLDER_ID
 */

// Central configuration keeps sheet and header names in one readable location.
// Environment-specific IDs remain in Script Properties.
const CONFIG = Object.freeze({
  ACCESS_SHEET_NAME: 'CONFIG : อีเมลที่ได้รับสิทธิ์',
  CONSIGNMENT_SHEET_NAME: 'MAIN : สินค้าฝากขาย',
  RECEIVING_LOG_SHEET_NAME: 'LOG : รับเข้าสินค้าฝากขาย',
  WITHDRAWAL_LOG_SHEET_NAME: 'LOG : สินค้าที่ถูกขอเบิก',
  CUSTOMER_MASTER_SHEET_NAME: 'MASTER : Customer',
  CUSTOMER_CODE_HEADER: 'รหัสลูกค้า',
  CUSTOMER_NAME_HEADER: 'ชื่อลูกค้า'
});

// Tire QR values contain exactly 10 uppercase English letters or digits.
// Letter and digit positions may vary, and either type may appear alone.
// Examples: D001000955, TN05200154, or ABCDEFGHIJ.
const TIRE_SERIAL_PATTERN = /^[A-Z0-9]{10}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const MAX_WITHDRAWAL_BATCH_ITEMS = 50;
const MAX_WITHDRAWAL_PHOTO_BYTES = 5 * 1024 * 1024;
const WITHDRAWAL_PHOTO_MIME_TYPE = 'image/jpeg';
