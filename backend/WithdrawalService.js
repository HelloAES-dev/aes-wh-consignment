/**
 * Customer withdrawal batch transaction service.
 */

// Resolve one scanned serial before the worker takes a photo. This provides
// useful product feedback without trusting the browser for ownership or status.
function lookupWithdrawalSerial(payload, authorizedUser) {
  const serialNumber = String(
    payload.serialNum || payload.serial_num || ''
  ).trim().toUpperCase();

  if (!TIRE_SERIAL_PATTERN.test(serialNumber)) {
    return createWithdrawalLookupFailure(
      serialNumber,
      'INVALID_SERIAL_FORMAT',
      'หมายเลข Serial ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 10 ตัว'
    );
  }

  const resolution = resolveWithdrawalItemForUser(
    serialNumber,
    authorizedUser
  );

  if (resolution.issue) {
    return createWithdrawalLookupFailure(
      serialNumber,
      resolution.issue.code,
      resolution.issue.message
    );
  }

  return {
    success: true,
    available: true,
    message: 'พบสินค้าพร้อมเบิก',
    item: createWithdrawalItemForClient(resolution.item)
  };
}

// Recheck a single serial from Sheets for both lookup and photo upload. The
// final batch submission performs the same validation again under its lock.
function resolveWithdrawalItemForUser(serialNumber, authorizedUser) {
  const spreadsheet = getSpreadsheet();
  const consignment = getWithdrawalConsignmentStructure(spreadsheet);
  const matches = findExactColumnMatches(
    consignment,
    'serial_num',
    serialNumber
  );

  if (matches.length === 0) {
    return {
      issue: createWithdrawalIssue(
        serialNumber,
        'SERIAL_NOT_FOUND',
        'ไม่พบหมายเลข Serial นี้ในระบบ'
      )
    };
  }

  if (matches.length > 1) {
    return {
      issue: createWithdrawalIssue(
        serialNumber,
        'DUPLICATE_SERIAL_REGISTRY',
        'พบหมายเลข Serial ซ้ำในฐานข้อมูล กรุณาแจ้งผู้ดูแลระบบ'
      )
    };
  }

  const rowNumber = matches[0].getRow();
  const row = consignment.sheet
    .getRange(rowNumber, 1, 1, consignment.headers.length)
    .getValues()[0];
  const item = createWithdrawalConsignmentItem(
    row,
    consignment.columns,
    rowNumber
  );

  if (item.customer_id !== authorizedUser.customer_id) {
    return {
      issue: createWithdrawalIssue(
        serialNumber,
        'WRONG_CUSTOMER',
        'สินค้านี้ไม่ได้อยู่ในสิทธิ์ของลูกค้ารายนี้'
      )
    };
  }

  if (item.inventory_status === 'WITHDRAWN') {
    return {
      issue: createWithdrawalIssue(
        serialNumber,
        'ALREADY_WITHDRAWN',
        'สินค้านี้ถูกเบิกออกไปแล้ว'
      )
    };
  }

  if (item.inventory_status !== 'RECEIVED') {
    return {
      issue: createWithdrawalIssue(
        serialNumber,
        'INVALID_INVENTORY_STATUS',
        'สินค้านี้ยังไม่อยู่ในสถานะพร้อมเบิก'
      )
    };
  }

  return {
    item: item
  };
}

function createWithdrawalLookupFailure(serialNumber, code, message) {
  return {
    success: true,
    available: false,
    code: code,
    message: message,
    serial_num: serialNumber
  };
}

function createWithdrawalItemForClient(item) {
  return {
    consignment_item_id: item.consignment_item_id,
    ord_num: item.ord_num,
    customer_id: item.customer_id,
    customer_name_snapshot: item.customer_name_snapshot,
    lot_num: item.lot_num,
    product_code: item.product_code,
    product_name_snapshot: item.product_name_snapshot,
    serial_num: item.serial_num,
    inventory_status: item.inventory_status
  };
}

// Submit one customer withdrawal batch. Every item is validated before any
// Sheet write so a partially invalid batch cannot withdraw only some tires.
function submitWithdrawalBatch(payload, authorizedUser) {
  const request = normalizeWithdrawalRequest(payload);
  const requestError = validateWithdrawalRequest(request);

  if (requestError) {
    return requestError;
  }

  const scriptLock = LockService.getScriptLock();

  if (!scriptLock.tryLock(10000)) {
    return {
      success: false,
      code: 'LOCK_TIMEOUT',
      message: 'ระบบกำลังบันทึกรายการอื่น กรุณาลองส่งอีกครั้ง'
    };
  }

  try {
    const spreadsheet = getSpreadsheet();
    const withdrawalLog = getWithdrawalLogStructure(spreadsheet);
    const previousRecords = findWithdrawalRecordsByClientRequestId(
      withdrawalLog,
      request.client_request_id
    );

    // A retry returns the original batch without creating more log rows or
    // changing inventory a second time.
    if (previousRecords.length > 0) {
      if (
        !isSameWithdrawalRequest(
          previousRecords,
          request,
          authorizedUser
        )
      ) {
        return {
          success: false,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'รหัสคำขอนี้ถูกใช้งานแล้ว กรุณาส่งรายการใหม่'
        };
      }

      return createWithdrawalResponse(previousRecords, true);
    }

    const consignment = getWithdrawalConsignmentStructure(spreadsheet);
    const resolution = resolveWithdrawalItems(
      consignment,
      request.items,
      authorizedUser
    );

    if (resolution.issues.length > 0) {
      return {
        success: true,
        accepted: false,
        idempotent: false,
        code: 'WITHDRAWAL_BATCH_REJECTED',
        message: 'บางรายการไม่สามารถเบิกได้ กรุณาตรวจสอบก่อนส่งอีกครั้ง',
        issues: resolution.issues
      };
    }

    const photoResolution = resolveWithdrawalPhotos(resolution.items);

    if (photoResolution.issues.length > 0) {
      return {
        success: true,
        accepted: false,
        idempotent: false,
        code: 'WITHDRAWAL_PHOTO_REJECTED',
        message: 'ไม่สามารถยืนยันรูปภาพของบางรายการได้',
        issues: photoResolution.issues
      };
    }

    const timestamp = new Date();
    const withdrawalRecords = createWithdrawalRecords(
      request,
      photoResolution.items,
      authorizedUser,
      timestamp
    );

    updateConsignmentsAsWithdrawn(
      consignment,
      photoResolution.items,
      authorizedUser,
      timestamp
    );
    appendWithdrawalRecords(withdrawalLog, withdrawalRecords);
    SpreadsheetApp.flush();

    return createWithdrawalResponse(withdrawalRecords, false);
  } finally {
    scriptLock.releaseLock();
  }
}

// Normalize camelCase browser fields and snake_case API fields into one
// internal request contract.
function normalizeWithdrawalRequest(payload) {
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  return {
    client_request_id: String(
      payload.clientRequestId || payload.client_request_id || ''
    ).trim(),
    withdrawal_batch_id: String(
      payload.withdrawalBatchId || payload.withdrawal_batch_id || ''
    ).trim(),
    items: rawItems.map(function (item) {
      const safeItem = item && typeof item === 'object' ? item : {};

      return {
        serial_num: String(
          safeItem.serialNum || safeItem.serial_num || ''
        ).trim().toUpperCase(),
        photo_drive_file_id: String(
          safeItem.photoDriveFileId || safeItem.photo_drive_file_id || ''
        ).trim()
      };
    })
  };
}

function validateWithdrawalRequest(request) {
  if (!REQUEST_ID_PATTERN.test(request.client_request_id)) {
    return {
      success: false,
      code: 'INVALID_CLIENT_REQUEST_ID',
      message: 'ไม่พบรหัสคำขอที่ถูกต้อง กรุณาเริ่มรายการใหม่'
    };
  }

  if (!REQUEST_ID_PATTERN.test(request.withdrawal_batch_id)) {
    return {
      success: false,
      code: 'INVALID_WITHDRAWAL_BATCH_ID',
      message: 'ไม่พบรหัสชุดเบิกที่ถูกต้อง กรุณาเริ่มรายการใหม่'
    };
  }

  if (
    request.items.length === 0 ||
    request.items.length > MAX_WITHDRAWAL_BATCH_ITEMS
  ) {
    return {
      success: false,
      code: 'INVALID_WITHDRAWAL_BATCH_SIZE',
      message: `กรุณาส่งรายการตั้งแต่ 1 ถึง ${MAX_WITHDRAWAL_BATCH_ITEMS} เส้น`
    };
  }

  const issues = [];
  const seenSerials = {};

  request.items.forEach(function (item) {
    if (!TIRE_SERIAL_PATTERN.test(item.serial_num)) {
      issues.push(createWithdrawalIssue(
        item.serial_num,
        'INVALID_SERIAL_FORMAT',
        'หมายเลข Serial ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 10 ตัว'
      ));
    }

    if (seenSerials[item.serial_num]) {
      issues.push(createWithdrawalIssue(
        item.serial_num,
        'DUPLICATE_SERIAL_IN_BATCH',
        'หมายเลข Serial ซ้ำในชุดเบิกเดียวกัน'
      ));
    }

    seenSerials[item.serial_num] = true;

    if (!DRIVE_FILE_ID_PATTERN.test(item.photo_drive_file_id)) {
      issues.push(createWithdrawalIssue(
        item.serial_num,
        'PHOTO_REQUIRED',
        'กรุณาอัปโหลดรูปภาพของสินค้าก่อนส่งรายการ'
      ));
    }
  });

  if (issues.length > 0) {
    return {
      success: true,
      accepted: false,
      idempotent: false,
      code: 'INVALID_WITHDRAWAL_REQUEST',
      message: 'ข้อมูลชุดเบิกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
      issues: issues
    };
  }

  return null;
}

function createWithdrawalIssue(serialNumber, code, message) {
  return {
    serial_num: serialNumber,
    code: code,
    message: message
  };
}

// Resolve every requested serial from one Sheet read, then reject the entire
// batch if any item is missing, belongs to another customer, or is not received.
function resolveWithdrawalItems(consignment, requestedItems, authorizedUser) {
  const registry = createWithdrawalConsignmentRegistry(consignment);
  const resolvedItems = [];
  const issues = [];

  requestedItems.forEach(function (requestedItem) {
    const matches = registry[requestedItem.serial_num] || [];

    if (matches.length === 0) {
      issues.push(createWithdrawalIssue(
        requestedItem.serial_num,
        'SERIAL_NOT_FOUND',
        'ไม่พบหมายเลข Serial นี้ในระบบ'
      ));
      return;
    }

    if (matches.length > 1) {
      issues.push(createWithdrawalIssue(
        requestedItem.serial_num,
        'DUPLICATE_SERIAL_REGISTRY',
        'พบหมายเลข Serial ซ้ำในฐานข้อมูล กรุณาแจ้งผู้ดูแลระบบ'
      ));
      return;
    }

    const item = matches[0];

    if (item.customer_id !== authorizedUser.customer_id) {
      issues.push(createWithdrawalIssue(
        requestedItem.serial_num,
        'WRONG_CUSTOMER',
        'สินค้านี้ไม่ได้อยู่ในสิทธิ์ของลูกค้ารายนี้'
      ));
      return;
    }

    if (item.inventory_status === 'WITHDRAWN') {
      issues.push(createWithdrawalIssue(
        requestedItem.serial_num,
        'ALREADY_WITHDRAWN',
        'สินค้านี้ถูกเบิกออกไปแล้ว'
      ));
      return;
    }

    if (item.inventory_status !== 'RECEIVED') {
      issues.push(createWithdrawalIssue(
        requestedItem.serial_num,
        'INVALID_INVENTORY_STATUS',
        'สินค้านี้ยังไม่อยู่ในสถานะพร้อมเบิก'
      ));
      return;
    }

    resolvedItems.push(Object.assign({}, item, {
      photo_drive_file_id: requestedItem.photo_drive_file_id
    }));
  });

  return {
    items: resolvedItems,
    issues: issues
  };
}

function createWithdrawalRecords(
  request,
  resolvedItems,
  authorizedUser,
  timestamp
) {
  return resolvedItems.map(function (item) {
    return {
      withdrawal_id: `WDR-${Utilities.getUuid()}`,
      client_request_id: request.client_request_id,
      withdrawal_batch_id: request.withdrawal_batch_id,
      consignment_item_id: item.consignment_item_id,
      ord_num: item.ord_num,
      customer_id: item.customer_id,
      customer_name_snapshot: item.customer_name_snapshot,
      lot_num: item.lot_num,
      product_code: item.product_code,
      product_name_snapshot: item.product_name_snapshot,
      serial_num: item.serial_num,
      withdrawn_by_user_id: authorizedUser.user_id,
      withdrawn_by_email: authorizedUser.email,
      submitted_at: timestamp,
      request_status: 'SUBMITTED',
      approved_by_user_id: '',
      approved_by_email: '',
      approved_at: '',
      rejection_reason: '',
      photo_drive_file_id: item.photo_drive_file_id,
      photo_drive_url: item.photo_drive_url,
      photo_uploaded_at: item.photo_uploaded_at,
      photo_upload_status: 'UPLOADED',
      chat_notification_status: 'PENDING',
      chat_notified_at: '',
      chat_message_name: '',
      admin_notes: '',
      updated_at: timestamp
    };
  });
}

// Apply the same status and audit values through RangeList so a ten-tire batch
// does not make one separate setValue call for every cell.
function updateConsignmentsAsWithdrawn(
  consignment,
  items,
  authorizedUser,
  timestamp
) {
  const rowNumbers = items.map(function (item) {
    return item.row_number;
  });

  setColumnForRows(
    consignment.sheet,
    rowNumbers,
    consignment.columns.inventory_status + 1,
    'WITHDRAWN'
  );
  setColumnForRows(
    consignment.sheet,
    rowNumbers,
    consignment.columns.updated_at + 1,
    timestamp
  );
  setColumnForRows(
    consignment.sheet,
    rowNumbers,
    consignment.columns.updated_by + 1,
    authorizedUser.email
  );
}

function setColumnForRows(sheet, rowNumbers, columnNumber, value) {
  const columnLetter = convertColumnNumberToLetter(columnNumber);
  const ranges = rowNumbers.map(function (rowNumber) {
    return `${columnLetter}${rowNumber}`;
  });

  sheet.getRangeList(ranges).setValue(value);
}

function convertColumnNumberToLetter(columnNumber) {
  let dividend = columnNumber;
  let columnLetter = '';

  while (dividend > 0) {
    const remainder = (dividend - 1) % 26;
    columnLetter = String.fromCharCode(65 + remainder) + columnLetter;
    dividend = Math.floor((dividend - remainder) / 26);
  }

  return columnLetter;
}

function appendWithdrawalRecords(withdrawalLog, records) {
  const rows = records.map(function (record) {
    return createRowFromObject(withdrawalLog.headers, record);
  });
  const nextRow = Math.max(withdrawalLog.sheet.getLastRow() + 1, 2);

  withdrawalLog.sheet
    .getRange(nextRow, 1, rows.length, withdrawalLog.headers.length)
    .setValues(rows);
}

function createWithdrawalResponse(records, idempotent) {
  const firstRecord = records[0];

  return {
    success: true,
    accepted: true,
    idempotent: idempotent,
    message: idempotent
      ? 'รายการนี้ถูกบันทึกไว้แล้ว'
      : 'ส่งรายการเบิกสินค้าสำเร็จ',
    batch: {
      client_request_id: firstRecord.client_request_id,
      withdrawal_batch_id: firstRecord.withdrawal_batch_id,
      customer_id: firstRecord.customer_id,
      customer_name_snapshot: firstRecord.customer_name_snapshot,
      request_status: firstRecord.request_status,
      item_count: records.length,
      products: createWithdrawalProductSummary(records),
      items: records.map(function (record) {
        return {
          withdrawal_id: record.withdrawal_id,
          consignment_item_id: record.consignment_item_id,
          serial_num: record.serial_num,
          product_code: record.product_code,
          product_name_snapshot: record.product_name_snapshot,
          request_status: record.request_status
        };
      })
    }
  };
}

function createWithdrawalProductSummary(records) {
  const productsByKey = {};

  records.forEach(function (record) {
    const key = `${record.product_code}\u0000${record.product_name_snapshot}`;

    if (!productsByKey[key]) {
      productsByKey[key] = {
        product_code: record.product_code,
        product_name_snapshot: record.product_name_snapshot,
        quantity: 0
      };
    }

    productsByKey[key].quantity += 1;
  });

  return Object.keys(productsByKey)
    .sort()
    .map(function (key) {
      return productsByKey[key];
    });
}

function isSameWithdrawalRequest(records, request, authorizedUser) {
  if (
    records.some(function (record) {
      return (
        record.withdrawal_batch_id !== request.withdrawal_batch_id ||
        record.withdrawn_by_user_id !== authorizedUser.user_id ||
        record.withdrawn_by_email !== authorizedUser.email ||
        record.customer_id !== authorizedUser.customer_id
      );
    })
  ) {
    return false;
  }

  const requestedPhotosBySerial = {};
  const recordedPhotosBySerial = {};

  request.items.forEach(function (item) {
    requestedPhotosBySerial[item.serial_num] = item.photo_drive_file_id;
  });
  records.forEach(function (record) {
    recordedPhotosBySerial[record.serial_num] = record.photo_drive_file_id;
  });

  return createWithdrawalPhotoFingerprint(requestedPhotosBySerial) ===
    createWithdrawalPhotoFingerprint(recordedPhotosBySerial);
}

function createWithdrawalPhotoFingerprint(photosBySerial) {
  return Object.keys(photosBySerial)
    .sort()
    .map(function (serialNumber) {
      return `${serialNumber}:${photosBySerial[serialNumber]}`;
    })
    .join('|');
}
