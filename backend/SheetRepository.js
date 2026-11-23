/**
 * Google Sheets structures, lookups, row mapping, and write helpers.
 */

// Read and validate the access sheet structure.
function getAccessSheetData() {
  const sheet = getSpreadsheet().getSheetByName(CONFIG.ACCESS_SHEET_NAME);

  if (!sheet) {
    throw new Error(`Missing sheet: ${CONFIG.ACCESS_SHEET_NAME}`);
  }

  const values = sheet.getDataRange().getValues();
  const headerRow = values[0] || [];
  const columns = createHeaderMap(headerRow);
  const requiredHeaders = [
    'user_id',
    'email',
    'customer_id',
    'role',
    'can_withdraw',
    'can_receive',
    'is_admin',
    'is_active',
    'created_at',
    'created_by',
    'updated_at',
    'updated_by'
  ];

  assertRequiredHeaders(columns, requiredHeaders, CONFIG.ACCESS_SHEET_NAME);

  return {
    sheet: sheet,
    values: values,
    columns: columns
  };
}

// Read only the headers first. Individual rows are resolved through exact
// serial/request-ID searches so each scan does not load the entire workbook.
function getConsignmentStructure(spreadsheet) {
  return getSheetStructure(
    spreadsheet,
    CONFIG.CONSIGNMENT_SHEET_NAME,
    [
      'consignment_item_id',
      'customer_id',
      'serial_num',
      'inventory_status',
      'received_at',
      'received_by_user_id',
      'received_by_email',
      'updated_at',
      'updated_by'
    ]
  );
}

function getReceivingLogStructure(spreadsheet) {
  return getSheetStructure(
    spreadsheet,
    CONFIG.RECEIVING_LOG_SHEET_NAME,
    [
      'receiving_id',
      'receiving_batch_id',
      'consignment_item_id',
      'serial_num',
      'customer_id',
      'received_by_user_id',
      'received_by_email',
      'received_at',
      'receiving_status',
      'error_code',
      'notes',
      'created_at'
    ]
  );
}

function getWithdrawalConsignmentStructure(spreadsheet) {
  return getSheetStructure(
    spreadsheet,
    CONFIG.CONSIGNMENT_SHEET_NAME,
    [
      'consignment_item_id',
      'ord_num',
      'customer_id',
      'customer_name_snapshot',
      'lot_num',
      'product_code',
      'product_name_snapshot',
      'serial_num',
      'inventory_status',
      'updated_at',
      'updated_by'
    ]
  );
}

function getWithdrawalLogStructure(spreadsheet) {
  return getSheetStructure(
    spreadsheet,
    CONFIG.WITHDRAWAL_LOG_SHEET_NAME,
    [
      'withdrawal_id',
      'client_request_id',
      'withdrawal_batch_id',
      'consignment_item_id',
      'ord_num',
      'customer_id',
      'customer_name_snapshot',
      'lot_num',
      'product_code',
      'product_name_snapshot',
      'serial_num',
      'withdrawn_by_user_id',
      'withdrawn_by_email',
      'submitted_at',
      'request_status',
      'approved_by_user_id',
      'approved_by_email',
      'approved_at',
      'rejection_reason',
      'photo_drive_file_id',
      'photo_drive_url',
      'photo_uploaded_at',
      'photo_upload_status',
      'chat_notification_status',
      'chat_notified_at',
      'chat_message_name',
      'admin_notes',
      'updated_at'
    ]
  );
}

function getSheetStructure(spreadsheet, sheetName, requiredHeaders) {
  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(`Missing sheet: ${sheetName}`);
  }

  const lastColumn = sheet.getLastColumn();

  if (lastColumn === 0) {
    throw new Error(`Missing header row in sheet: ${sheetName}`);
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const columns = createHeaderMap(headers);

  assertRequiredHeaders(columns, requiredHeaders, sheetName);

  return {
    sheet: sheet,
    headers: headers,
    columns: columns
  };
}

function findExactColumnMatches(sheetStructure, header, value) {
  const lastDataRow = sheetStructure.sheet.getLastRow();

  if (lastDataRow < 2) {
    return [];
  }

  return sheetStructure.sheet
    .getRange(
      2,
      sheetStructure.columns[header] + 1,
      lastDataRow - 1,
      1
    )
    .createTextFinder(value)
    .matchEntireCell(true)
    .matchCase(true)
    .findAll();
}

function createConsignmentItem(consignment, rowNumber) {
  const row = consignment.sheet
    .getRange(rowNumber, 1, 1, consignment.headers.length)
    .getValues()[0];

  return {
    row: row,
    row_number: rowNumber,
    consignment_item_id: String(
      row[consignment.columns.consignment_item_id] || ''
    ).trim(),
    customer_id: String(row[consignment.columns.customer_id] || '').trim(),
    serial_num: String(row[consignment.columns.serial_num] || '')
      .trim()
      .toUpperCase(),
    inventory_status: String(
      row[consignment.columns.inventory_status] || ''
    ).trim().toUpperCase()
  };
}

// Build one serial registry from a single Sheet read. This is faster for a
// multi-tire batch than running a separate TextFinder search for every serial.
function createWithdrawalConsignmentRegistry(consignment) {
  const lastDataRow = consignment.sheet.getLastRow();
  const registry = {};

  if (lastDataRow < 2) {
    return registry;
  }

  const rows = consignment.sheet
    .getRange(2, 1, lastDataRow - 1, consignment.headers.length)
    .getValues();

  rows.forEach(function (row, index) {
    const item = createWithdrawalConsignmentItem(
      row,
      consignment.columns,
      index + 2
    );

    if (!item.serial_num) {
      return;
    }

    if (!registry[item.serial_num]) {
      registry[item.serial_num] = [];
    }

    registry[item.serial_num].push(item);
  });

  return registry;
}

function createWithdrawalConsignmentItem(row, columns, rowNumber) {
  return {
    row_number: rowNumber,
    consignment_item_id: String(
      row[columns.consignment_item_id] || ''
    ).trim(),
    ord_num: String(row[columns.ord_num] || '').trim(),
    customer_id: String(row[columns.customer_id] || '').trim(),
    customer_name_snapshot: String(
      row[columns.customer_name_snapshot] || ''
    ).trim(),
    lot_num: String(row[columns.lot_num] || '').trim(),
    product_code: String(row[columns.product_code] || '').trim(),
    product_name_snapshot: String(
      row[columns.product_name_snapshot] || ''
    ).trim(),
    serial_num: String(row[columns.serial_num] || '').trim().toUpperCase(),
    inventory_status: String(
      row[columns.inventory_status] || ''
    ).trim().toUpperCase()
  };
}

function findWithdrawalRecordsByClientRequestId(
  withdrawalLog,
  clientRequestId
) {
  const matches = findExactColumnMatches(
    withdrawalLog,
    'client_request_id',
    clientRequestId
  );

  return matches.map(function (match) {
    const row = withdrawalLog.sheet
      .getRange(match.getRow(), 1, 1, withdrawalLog.headers.length)
      .getValues()[0];

    return createWithdrawalRecordFromRow(row, withdrawalLog.columns);
  });
}

function createWithdrawalRecordFromRow(row, columns) {
  return {
    withdrawal_id: String(row[columns.withdrawal_id] || '').trim(),
    client_request_id: String(row[columns.client_request_id] || '').trim(),
    withdrawal_batch_id: String(
      row[columns.withdrawal_batch_id] || ''
    ).trim(),
    consignment_item_id: String(
      row[columns.consignment_item_id] || ''
    ).trim(),
    ord_num: String(row[columns.ord_num] || '').trim(),
    customer_id: String(row[columns.customer_id] || '').trim(),
    customer_name_snapshot: String(
      row[columns.customer_name_snapshot] || ''
    ).trim(),
    lot_num: String(row[columns.lot_num] || '').trim(),
    product_code: String(row[columns.product_code] || '').trim(),
    product_name_snapshot: String(
      row[columns.product_name_snapshot] || ''
    ).trim(),
    serial_num: String(row[columns.serial_num] || '').trim().toUpperCase(),
    withdrawn_by_user_id: String(
      row[columns.withdrawn_by_user_id] || ''
    ).trim(),
    withdrawn_by_email: normalizeEmail(
      row[columns.withdrawn_by_email]
    ),
    submitted_at: row[columns.submitted_at] || '',
    request_status: String(
      row[columns.request_status] || ''
    ).trim().toUpperCase(),
    photo_drive_file_id: String(
      row[columns.photo_drive_file_id] || ''
    ).trim(),
    photo_drive_url: String(row[columns.photo_drive_url] || '').trim(),
    photo_uploaded_at: row[columns.photo_uploaded_at] || '',
    photo_upload_status: String(
      row[columns.photo_upload_status] || ''
    ).trim().toUpperCase(),
    chat_notification_status: String(
      row[columns.chat_notification_status] || ''
    ).trim().toUpperCase(),
    updated_at: row[columns.updated_at] || ''
  };
}

function findReceivingLogById(receivingLog, receivingId) {
  const matches = findExactColumnMatches(
    receivingLog,
    'receiving_id',
    receivingId
  );

  if (matches.length === 0) {
    return null;
  }

  const row = receivingLog.sheet
    .getRange(matches[0].getRow(), 1, 1, receivingLog.headers.length)
    .getValues()[0];

  return {
    receiving_id: String(row[receivingLog.columns.receiving_id] || '').trim(),
    receiving_batch_id: String(
      row[receivingLog.columns.receiving_batch_id] || ''
    ).trim(),
    consignment_item_id: String(
      row[receivingLog.columns.consignment_item_id] || ''
    ).trim(),
    serial_num: String(row[receivingLog.columns.serial_num] || '').trim(),
    customer_id: String(row[receivingLog.columns.customer_id] || '').trim(),
    received_by_user_id: String(
      row[receivingLog.columns.received_by_user_id] || ''
    ).trim(),
    received_by_email: normalizeEmail(
      row[receivingLog.columns.received_by_email]
    ),
    received_at: row[receivingLog.columns.received_at] || '',
    receiving_status: String(
      row[receivingLog.columns.receiving_status] || ''
    ).trim().toUpperCase(),
    error_code: String(row[receivingLog.columns.error_code] || '').trim()
  };
}

// Create a row in the exact order of the configured sheet headers.
function createRowFromObject(headerRow, valuesByHeader) {
  return headerRow.map(function (header) {
    const normalizedHeader = String(header || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(valuesByHeader, normalizedHeader)
      ? valuesByHeader[normalizedHeader]
      : '';
  });
}

// Open the configured spreadsheet only when a request needs sheet data.
function getSpreadsheet() {
  return SpreadsheetApp.openById(getRequiredScriptProperty('SPREADSHEET_ID'));
}

// Read required configuration from Script Properties and fail clearly when it
// has not been configured in the Apps Script project.
function getRequiredScriptProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);

  if (!value) {
    throw new Error(`Missing Script Property: ${name}`);
  }

  return value.trim();
}

// Convert the header row into a case-insensitive name-to-index lookup table.
function createHeaderMap(headerRow) {
  return headerRow.reduce(function (map, header, index) {
    const normalizedHeader = String(header || '').trim().toLowerCase();

    if (normalizedHeader) {
      map[normalizedHeader] = index;
    }

    return map;
  }, {});
}

function assertRequiredHeaders(columns, requiredHeaders, sheetName) {
  requiredHeaders.forEach(function (header) {
    const normalizedHeader = String(header).trim().toLowerCase();

    if (columns[normalizedHeader] === undefined) {
      throw new Error(`Missing column in ${sheetName}: ${header}`);
    }
  });
}
