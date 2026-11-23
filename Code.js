/**
 * Consignment Apps Script backend.
 *
 * Provides Google authentication, permission enforcement, account management,
 * receiving transactions, and withdrawal transactions.
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

// Health-check endpoint used to confirm that the web app is reachable.
function doGet() {
  return ContentService
    .createTextOutput(
      JSON.stringify({
        success: true,
        service: 'consignment-backend'
      })
    )
    .setMimeType(ContentService.MimeType.JSON);
}

// Main POST endpoint. Authentication is required before any action is allowed
// to run, and every ADMIN action is checked again on the backend.
function doPost(event) {
  try {
    const payload = parseRequestPayload(event);
    const identity = verifyGoogleIdToken(payload.idToken);

    if (!identity) {
      return createErrorResponse(
        'AUTHENTICATION_REQUIRED',
        'กรุณาลงชื่อเข้าใช้ด้วยบัญชี Google ที่ถูกต้อง'
      );
    }

    const authorizedUser = findAuthorizedUser(identity.email);

    if (!authorizedUser || !authorizedUser.is_active) {
      return createErrorResponse(
        'ACCESS_DENIED',
        'บัญชี Google นี้ยังไม่ได้รับสิทธิ์ใช้งาน'
      );
    }

    const action = String(payload.action || '').trim();

    // Keep routing explicit so unknown operations fail safely.
    switch (action) {
      case 'authCheck':
        return createJsonResponse({
          success: true,
          user: sanitizeUserForClient(authorizedUser)
        });

      case 'adminListUsers':
        return handleAdminAction(authorizedUser, function () {
          return {
            success: true,
            users: listAuthorizedUsers()
          };
        });

      case 'adminSearchCustomers':
        return handleAdminAction(authorizedUser, function () {
          return {
            success: true,
            customers: searchCustomers(payload.query)
          };
        });

      case 'adminCreateUser':
        return handleAdminAction(authorizedUser, function () {
          return createAuthorizedUser(payload.user, authorizedUser);
        });

      case 'adminUpdateUserAccess':
        return handleAdminAction(authorizedUser, function () {
          return updateAuthorizedUserAccess(
            payload.userId,
            payload.user,
            authorizedUser
          );
        });

      case 'adminSetUserActive':
        return handleAdminAction(authorizedUser, function () {
          return setAuthorizedUserActive(
            payload.userId,
            payload.isActive,
            authorizedUser
          );
        });

      case 'receiveSerial':
        return handleReceivingAction(authorizedUser, function () {
          return receiveConsignmentSerial(payload, authorizedUser);
        });

      case 'submitWithdrawalBatch':
        return handleWithdrawalAction(authorizedUser, function () {
          return submitWithdrawalBatch(payload, authorizedUser);
        });

      default:
        return createErrorResponse(
          'UNKNOWN_ACTION',
          'ยังไม่รองรับคำสั่งนี้ในระบบ'
        );
    }
  } catch (error) {
    console.error('Backend request failed:', error);

    return createErrorResponse(
      'SERVER_ERROR',
      'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง'
    );
  }
}

// Run one action only after confirming that the authenticated account is an
// active ADMIN. UI visibility is never treated as an authorization boundary.
function handleAdminAction(authorizedUser, actionHandler) {
  if (!authorizedUser.permissions.is_admin || !authorizedUser.is_active) {
    return createErrorResponse(
      'ADMIN_REQUIRED',
      'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดำเนินการนี้ได้'
    );
  }

  return createJsonResponse(actionHandler());
}

// Receiving permission is enforced on the backend even when the frontend
// hides the receiving module from unauthorized users.
function handleReceivingAction(authorizedUser, actionHandler) {
  if (!authorizedUser.permissions.can_receive || !authorizedUser.is_active) {
    return createErrorResponse(
      'RECEIVING_PERMISSION_REQUIRED',
      'บัญชีนี้ไม่มีสิทธิ์ตรวจรับสินค้า'
    );
  }

  return createJsonResponse(actionHandler());
}

// Withdrawal permission and a customer assignment are mandatory. Internal
// Admin status does not allow cross-customer physical withdrawal.
function handleWithdrawalAction(authorizedUser, actionHandler) {
  if (!authorizedUser.permissions.can_withdraw || !authorizedUser.is_active) {
    return createErrorResponse(
      'WITHDRAWAL_PERMISSION_REQUIRED',
      'บัญชีนี้ไม่มีสิทธิ์เบิกสินค้า'
    );
  }

  if (!authorizedUser.customer_id) {
    return createErrorResponse(
      'WITHDRAWAL_CUSTOMER_REQUIRED',
      'บัญชีนี้ยังไม่ได้ผูกกับรหัสลูกค้า'
    );
  }

  return createJsonResponse(actionHandler());
}

// Validate and record one physical receiving scan. A short script lock keeps
// the inventory transition and duplicate check safe during simultaneous scans.
function receiveConsignmentSerial(payload, authorizedUser) {
  const request = normalizeReceivingRequest(payload);
  const requestError = validateReceivingRequest(request);

  if (requestError) {
    return requestError;
  }

  const receivingId = `RCV-${request.client_request_id}`;
  const scriptLock = LockService.getScriptLock();

  if (!scriptLock.tryLock(10000)) {
    return {
      success: false,
      code: 'LOCK_TIMEOUT',
      message: 'ระบบกำลังบันทึกรายการอื่น กรุณาสแกนอีกครั้ง'
    };
  }

  try {
    const spreadsheet = getSpreadsheet();
    const receivingLog = getReceivingLogStructure(spreadsheet);
    const previousLog = findReceivingLogById(receivingLog, receivingId);

    // A network retry with the same client request ID returns the original
    // outcome instead of appending another log or changing inventory again.
    if (previousLog) {
      if (!isSameReceivingRequest(previousLog, request, authorizedUser)) {
        return {
          success: false,
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'รหัสคำขอนี้ถูกใช้งานแล้ว กรุณาสแกนใหม่อีกครั้ง'
        };
      }

      return createReceivingResponse(previousLog, true);
    }

    if (!TIRE_SERIAL_PATTERN.test(request.serial_num)) {
      return recordReceivingOutcome(
        receivingLog,
        createReceivingOutcome({
          receiving_id: receivingId,
          receiving_batch_id: request.receiving_batch_id,
          serial_num: request.serial_num,
          customer_id: authorizedUser.customer_id,
          received_by_user_id: authorizedUser.user_id,
          received_by_email: authorizedUser.email,
          receiving_status: 'INVALID',
          error_code: 'INVALID_SERIAL_FORMAT',
          notes: 'Serial must contain exactly 10 uppercase English letters or digits.',
          message: 'รูปแบบหมายเลข Serial ไม่ถูกต้อง'
        })
      );
    }

    const consignment = getConsignmentStructure(spreadsheet);
    const matches = findExactColumnMatches(
      consignment,
      'serial_num',
      request.serial_num
    );

    if (matches.length === 0) {
      return recordReceivingOutcome(
        receivingLog,
        createReceivingOutcome({
          receiving_id: receivingId,
          receiving_batch_id: request.receiving_batch_id,
          serial_num: request.serial_num,
          customer_id: authorizedUser.customer_id,
          received_by_user_id: authorizedUser.user_id,
          received_by_email: authorizedUser.email,
          receiving_status: 'NOT_FOUND',
          error_code: 'SERIAL_NOT_FOUND',
          notes: 'No consignment item matches the scanned serial.',
          message: 'ไม่พบหมายเลข Serial นี้ในระบบ'
        })
      );
    }

    if (matches.length > 1) {
      return recordReceivingOutcome(
        receivingLog,
        createReceivingOutcome({
          receiving_id: receivingId,
          receiving_batch_id: request.receiving_batch_id,
          serial_num: request.serial_num,
          customer_id: authorizedUser.customer_id,
          received_by_user_id: authorizedUser.user_id,
          received_by_email: authorizedUser.email,
          receiving_status: 'INVALID',
          error_code: 'DUPLICATE_SERIAL_REGISTRY',
          notes: 'More than one consignment row uses the scanned serial.',
          message: 'พบหมายเลข Serial ซ้ำในฐานข้อมูล กรุณาแจ้งผู้ดูแลระบบ'
        })
      );
    }

    const item = createConsignmentItem(
      consignment,
      matches[0].getRow()
    );
    const outcome = evaluateReceivingOutcome(
      request,
      receivingId,
      item,
      authorizedUser
    );

    if (outcome.accepted) {
      updateConsignmentAsReceived(consignment, item, authorizedUser);
    }

    return recordReceivingOutcome(receivingLog, outcome);
  } finally {
    scriptLock.releaseLock();
  }
}

// Support both JavaScript-style and sheet/API-style field names while keeping
// one normalized internal representation.
function normalizeReceivingRequest(payload) {
  return {
    serial_num: String(payload.serialNum || payload.serial_num || '')
      .trim()
      .toUpperCase(),
    client_request_id: String(
      payload.clientRequestId || payload.client_request_id || ''
    ).trim(),
    receiving_batch_id: String(
      payload.receivingBatchId || payload.receiving_batch_id || ''
    ).trim()
  };
}

function validateReceivingRequest(request) {
  if (!REQUEST_ID_PATTERN.test(request.client_request_id)) {
    return {
      success: false,
      code: 'INVALID_CLIENT_REQUEST_ID',
      message: 'ไม่พบรหัสคำขอที่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง'
    };
  }

  if (!REQUEST_ID_PATTERN.test(request.receiving_batch_id)) {
    return {
      success: false,
      code: 'INVALID_RECEIVING_BATCH_ID',
      message: 'ไม่พบรหัสรอบตรวจรับที่ถูกต้อง กรุณาเริ่มรอบใหม่'
    };
  }

  return null;
}

// An idempotency key is valid only for the same authenticated user, batch,
// and serial. This prevents accidental collisions and cross-user data leaks.
function isSameReceivingRequest(previousLog, request, authorizedUser) {
  return (
    previousLog.received_by_user_id === authorizedUser.user_id &&
    previousLog.received_by_email === authorizedUser.email &&
    previousLog.receiving_batch_id === request.receiving_batch_id &&
    previousLog.serial_num === request.serial_num
  );
}

// Decide the outcome without writing to Sheets. Internal admins who also hold
// receiving permission may receive across customers for controlled support.
function evaluateReceivingOutcome(request, receivingId, item, authorizedUser) {
  const canReceiveAcrossCustomers = authorizedUser.permissions.is_admin;
  const ownsItem = item.customer_id === authorizedUser.customer_id;
  const sharedValues = {
    receiving_id: receivingId,
    receiving_batch_id: request.receiving_batch_id,
    consignment_item_id: item.consignment_item_id,
    serial_num: request.serial_num,
    customer_id: item.customer_id,
    received_by_user_id: authorizedUser.user_id,
    received_by_email: authorizedUser.email
  };

  if (!ownsItem && !canReceiveAcrossCustomers) {
    return createReceivingOutcome(Object.assign({}, sharedValues, {
      receiving_status: 'WRONG_CUSTOMER',
      error_code: 'WRONG_CUSTOMER',
      notes: 'The consignment item belongs to another customer.',
      message: 'สินค้านี้ไม่ได้อยู่ในสิทธิ์ของลูกค้ารายนี้'
    }));
  }

  switch (item.inventory_status) {
    case 'READY_TO_SHIP':
      return createReceivingOutcome(Object.assign({}, sharedValues, {
        accepted: true,
        receiving_status: 'RECEIVED',
        message: 'รับเข้าสินค้าสำเร็จ'
      }));

    case 'RECEIVED':
      return createReceivingOutcome(Object.assign({}, sharedValues, {
        receiving_status: 'DUPLICATE',
        error_code: 'ALREADY_RECEIVED',
        notes: 'The consignment item was already received.',
        message: 'สินค้านี้ถูกรับเข้าแล้ว'
      }));

    case 'WITHDRAWN':
      return createReceivingOutcome(Object.assign({}, sharedValues, {
        receiving_status: 'ALREADY_WITHDRAWN',
        error_code: 'ALREADY_WITHDRAWN',
        notes: 'The consignment item was already withdrawn.',
        message: 'สินค้านี้ถูกเบิกออกไปแล้ว'
      }));

    default:
      return createReceivingOutcome(Object.assign({}, sharedValues, {
        receiving_status: 'INVALID',
        error_code: 'INVALID_INVENTORY_STATUS',
        notes: `Receiving is not allowed from status ${item.inventory_status}.`,
        message: 'สถานะสินค้าไม่อนุญาตให้รับเข้า กรุณาแจ้งผู้ดูแลระบบ'
      }));
  }
}

function createReceivingOutcome(values) {
  const timestamp = new Date();

  return Object.assign({
    accepted: false,
    consignment_item_id: '',
    customer_id: '',
    received_at: timestamp,
    receiving_status: 'INVALID',
    error_code: '',
    notes: '',
    created_at: timestamp,
    message: 'ไม่สามารถรับเข้าสินค้าได้'
  }, values);
}

// Change only the status/audit ranges needed by receiving. Keeping these as
// two grouped writes avoids slow cell-by-cell updates.
function updateConsignmentAsReceived(consignment, item, authorizedUser) {
  const timestamp = new Date();
  const statusStartColumn = consignment.columns.inventory_status;
  const receiverEndColumn = consignment.columns.received_by_email;
  const statusValues = item.row.slice(
    statusStartColumn,
    receiverEndColumn + 1
  );

  statusValues[consignment.columns.inventory_status - statusStartColumn] =
    'RECEIVED';
  statusValues[consignment.columns.received_at - statusStartColumn] = timestamp;
  statusValues[
    consignment.columns.received_by_user_id - statusStartColumn
  ] = authorizedUser.user_id;
  statusValues[
    consignment.columns.received_by_email - statusStartColumn
  ] = authorizedUser.email;

  consignment.sheet
    .getRange(
      item.row_number,
      statusStartColumn + 1,
      1,
      statusValues.length
    )
    .setValues([statusValues]);

  consignment.sheet
    .getRange(item.row_number, consignment.columns.updated_at + 1, 1, 2)
    .setValues([[timestamp, authorizedUser.email]]);
}

// Persist every new scan outcome with one row write. Idempotent network
// retries are returned from their existing row and are not logged twice.
function recordReceivingOutcome(receivingLog, outcome) {
  const row = createRowFromObject(receivingLog.headers, outcome);
  const nextRow = Math.max(receivingLog.sheet.getLastRow() + 1, 2);

  receivingLog.sheet
    .getRange(nextRow, 1, 1, row.length)
    .setValues([row]);

  return createReceivingResponse(outcome, false);
}

function createReceivingResponse(outcome, idempotent) {
  return {
    success: true,
    accepted: outcome.receiving_status === 'RECEIVED',
    idempotent: idempotent,
    message: outcome.message || getReceivingMessage(outcome.receiving_status),
    receiving: {
      receiving_id: outcome.receiving_id,
      receiving_batch_id: outcome.receiving_batch_id,
      consignment_item_id: outcome.consignment_item_id,
      serial_num: outcome.serial_num,
      customer_id: outcome.customer_id,
      received_at: outcome.received_at,
      receiving_status: outcome.receiving_status,
      error_code: outcome.error_code || ''
    }
  };
}

function getReceivingMessage(status) {
  const messages = {
    RECEIVED: 'รับเข้าสินค้าสำเร็จ',
    DUPLICATE: 'สินค้านี้ถูกรับเข้าแล้ว',
    NOT_FOUND: 'ไม่พบหมายเลข Serial นี้ในระบบ',
    WRONG_CUSTOMER: 'สินค้านี้ไม่ได้อยู่ในสิทธิ์ของลูกค้ารายนี้',
    ALREADY_WITHDRAWN: 'สินค้านี้ถูกเบิกออกไปแล้ว',
    INVALID: 'ไม่สามารถรับเข้าสินค้าได้'
  };

  return messages[status] || messages.INVALID;
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

// Verify browser-provided file references against the configured company
// folder. File IDs alone are not trusted as proof of a completed upload.
function resolveWithdrawalPhotos(items) {
  const folderId = getRequiredScriptProperty('WITHDRAWAL_PHOTO_FOLDER_ID');
  const verifiedItems = [];
  const issues = [];

  // Confirm the folder exists before validating individual files.
  DriveApp.getFolderById(folderId).getName();

  items.forEach(function (item) {
    try {
      const file = DriveApp.getFileById(item.photo_drive_file_id);
      const mimeType = String(file.getMimeType() || '').toLowerCase();

      if (file.isTrashed()) {
        throw new Error('Photo file is in trash.');
      }

      if (!mimeType.startsWith('image/')) {
        throw new Error('Uploaded file is not an image.');
      }

      if (!isFileDirectlyInFolder(file, folderId)) {
        throw new Error('Photo file is outside the withdrawal folder.');
      }

      verifiedItems.push(Object.assign({}, item, {
        photo_drive_url: file.getUrl(),
        photo_uploaded_at: file.getDateCreated()
      }));
    } catch (error) {
      console.error(
        `Withdrawal photo validation failed for ${item.serial_num}:`,
        error
      );
      issues.push(createWithdrawalIssue(
        item.serial_num,
        'INVALID_WITHDRAWAL_PHOTO',
        'ไม่พบรูปภาพที่ถูกต้องของสินค้านี้ กรุณาอัปโหลดอีกครั้ง'
      ));
    }
  });

  return {
    items: verifiedItems,
    issues: issues
  };
}

function isFileDirectlyInFolder(file, folderId) {
  const parentFolders = file.getParents();

  while (parentFolders.hasNext()) {
    if (parentFolders.next().getId() === folderId) {
      return true;
    }
  }

  return false;
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

// Parse and validate the JSON request body before reading request fields.
function parseRequestPayload(event) {
  const contents = event && event.postData && event.postData.contents;

  if (!contents) {
    throw new Error('Request body is missing.');
  }

  const payload = JSON.parse(contents);

  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body must be a JSON object.');
  }

  return payload;
}

// Verify the Google Identity Services ID token against Google's token-info
// endpoint, then validate issuer, audience, email, and expiration.
function verifyGoogleIdToken(idToken) {
  if (!idToken) {
    return null;
  }

  const clientId = getRequiredScriptProperty('GOOGLE_CLIENT_ID');
  const response = UrlFetchApp.fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    {
      muteHttpExceptions: true
    }
  );

  if (response.getResponseCode() !== 200) {
    return null;
  }

  const claims = JSON.parse(response.getContentText());
  const issuer = String(claims.iss || '');
  const email = normalizeEmail(claims.email);
  const audience = String(claims.aud || '');
  const expiresAt = Number(claims.exp || 0);
  const emailVerified = String(claims.email_verified).toLowerCase() === 'true';
  const validIssuer =
    issuer === 'accounts.google.com' || issuer === 'https://accounts.google.com';
  const validAudience = audience === clientId;
  const notExpired = expiresAt > Math.floor(Date.now() / 1000);

  if (!email || !emailVerified || !validIssuer || !validAudience || !notExpired) {
    return null;
  }

  return {
    google_subject: String(claims.sub || ''),
    email: email
  };
}

// Find the signed-in user in the authorized-email sheet.
function findAuthorizedUser(email) {
  const accessData = getAccessSheetData();
  const normalizedEmail = normalizeEmail(email);

  for (let index = 1; index < accessData.values.length; index += 1) {
    const user = createAuthorizedUserObject(
      accessData.values[index],
      accessData.columns,
      index + 1
    );

    if (user.email === normalizedEmail) {
      return user;
    }
  }

  return null;
}

// List authorized users with a readable customer name for the admin screen.
function listAuthorizedUsers() {
  const accessData = getAccessSheetData();
  const customerNameById = createCustomerNameMap();
  const users = [];

  for (let index = 1; index < accessData.values.length; index += 1) {
    const user = createAuthorizedUserObject(
      accessData.values[index],
      accessData.columns,
      index + 1
    );

    if (!user.email) {
      continue;
    }

    users.push({
      user_id: user.user_id,
      email: user.email,
      customer_id: user.customer_id,
      customer_name: customerNameById[user.customer_id] || '',
      permissions: user.permissions,
      is_active: user.is_active
    });
  }

  return users.sort(function (leftUser, rightUser) {
    return leftUser.email.localeCompare(rightUser.email);
  });
}

// Search the customer master by customer code or customer name. Returning a
// small result set keeps the admin selector fast on mobile devices.
function searchCustomers(query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();

  if (normalizedQuery.length < 2) {
    return [];
  }

  const customerData = getCustomerMasterData();
  const results = [];

  for (let index = 1; index < customerData.values.length; index += 1) {
    const row = customerData.values[index];
    const customerId = String(
      row[customerData.columns[CONFIG.CUSTOMER_CODE_HEADER]] || ''
    ).trim();
    const customerName = String(
      row[customerData.columns[CONFIG.CUSTOMER_NAME_HEADER]] || ''
    ).trim();
    const searchableValue = `${customerId} ${customerName}`.toLowerCase();

    if (!customerId || !searchableValue.includes(normalizedQuery)) {
      continue;
    }

    results.push({
      customer_id: customerId,
      customer_name: customerName
    });

    if (results.length >= 20) {
      break;
    }
  }

  return results;
}

// Create a new authorized account. Locking protects the duplicate-email check
// and append operation from simultaneous admin requests.
function createAuthorizedUser(requestedUser, requestingAdmin) {
  const normalizedUser = normalizeRequestedUser(requestedUser);
  const validationError = validateRequestedUser(normalizedUser);

  if (validationError) {
    return validationError;
  }

  if (
    normalizedUser.customer_id &&
    !customerIdExists(normalizedUser.customer_id)
  ) {
    return {
      success: false,
      code: 'CUSTOMER_NOT_FOUND',
      message: 'ไม่พบรหัสลูกค้าที่เลือกในข้อมูล Master'
    };
  }

  const scriptLock = LockService.getScriptLock();

  try {
    scriptLock.waitLock(10000);

    if (findAuthorizedUser(normalizedUser.email)) {
      return {
        success: false,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'อีเมลนี้มีอยู่ในระบบแล้ว'
      };
    }

    const accessData = getAccessSheetData();
    const timestamp = new Date();
    const newUser = {
      user_id: `USR-${Utilities.getUuid()}`,
      email: normalizedUser.email,
      customer_id: normalizedUser.customer_id,
      role: normalizedUser.role,
      can_withdraw: normalizedUser.permissions.can_withdraw,
      can_receive: normalizedUser.permissions.can_receive,
      is_admin: normalizedUser.permissions.is_admin,
      permissions: normalizedUser.permissions,
      is_active: true,
      created_at: timestamp,
      created_by: requestingAdmin.email,
      updated_at: timestamp,
      updated_by: requestingAdmin.email
    };
    const newRow = createRowFromObject(
      accessData.values[0],
      newUser
    );

    accessData.sheet.appendRow(newRow);

    return {
      success: true,
      message: 'เพิ่มบัญชีที่ได้รับสิทธิ์เรียบร้อยแล้ว',
      user: sanitizeUserForClient(newUser)
    };
  } finally {
    if (scriptLock.hasLock()) {
      scriptLock.releaseLock();
    }
  }
}

// Update an existing account's permissions and customer assignment without
// changing its Google email or deleting its audit history.
function updateAuthorizedUserAccess(userId, requestedUser, requestingAdmin) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedAccess = normalizeRequestedAccess(requestedUser);
  const validationError = validateRequestedAccess(normalizedAccess);

  if (!normalizedUserId) {
    return {
      success: false,
      code: 'USER_ID_REQUIRED',
      message: 'ไม่พบรหัสผู้ใช้งาน'
    };
  }

  // Prevent an admin from accidentally removing the permission needed to
  // repair account configuration.
  if (normalizedUserId === requestingAdmin.user_id) {
    return {
      success: false,
      code: 'SELF_ACCESS_CHANGE_NOT_ALLOWED',
      message: 'ผู้ดูแลระบบไม่สามารถแก้ไขสิทธิ์บัญชีของตนเองได้'
    };
  }

  if (validationError) {
    return validationError;
  }

  if (
    normalizedAccess.customer_id &&
    !customerIdExists(normalizedAccess.customer_id)
  ) {
    return {
      success: false,
      code: 'CUSTOMER_NOT_FOUND',
      message: 'ไม่พบรหัสลูกค้าที่เลือกในข้อมูล Master'
    };
  }

  const scriptLock = LockService.getScriptLock();

  try {
    scriptLock.waitLock(10000);

    // Re-read the row after acquiring the lock so concurrent changes are not
    // overwritten with stale browser data.
    const accessData = getAccessSheetData();
    const targetUser = findAuthorizedUserById(accessData, normalizedUserId);

    if (!targetUser) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'ไม่พบบัญชีผู้ใช้งานที่ต้องการแก้ไข'
      };
    }

    const updatedRow = accessData.values[targetUser.row_number - 1].slice();
    updatedRow[accessData.columns.role] = normalizedAccess.role;
    updatedRow[accessData.columns.customer_id] = normalizedAccess.customer_id;
    updatedRow[accessData.columns.can_withdraw] =
      normalizedAccess.permissions.can_withdraw;
    updatedRow[accessData.columns.can_receive] =
      normalizedAccess.permissions.can_receive;
    updatedRow[accessData.columns.is_admin] =
      normalizedAccess.permissions.is_admin;
    updatedRow[accessData.columns.updated_at] = new Date();
    updatedRow[accessData.columns.updated_by] = requestingAdmin.email;

    accessData.sheet
      .getRange(targetUser.row_number, 1, 1, updatedRow.length)
      .setValues([updatedRow]);

    return {
      success: true,
      message: 'แก้ไขสิทธิ์บัญชีเรียบร้อยแล้ว'
    };
  } finally {
    if (scriptLock.hasLock()) {
      scriptLock.releaseLock();
    }
  }
}

// Activate or deactivate an authorized account without deleting its history.
function setAuthorizedUserActive(userId, isActive, requestingAdmin) {
  const normalizedUserId = String(userId || '').trim();

  if (typeof isActive !== 'boolean') {
    return {
      success: false,
      code: 'INVALID_ACTIVE_STATUS',
      message: 'สถานะบัญชีไม่ถูกต้อง'
    };
  }

  const nextIsActive = isActive;

  if (!normalizedUserId) {
    return {
      success: false,
      code: 'USER_ID_REQUIRED',
      message: 'ไม่พบรหัสผู้ใช้งาน'
    };
  }

  if (
    normalizedUserId === requestingAdmin.user_id &&
    nextIsActive === false
  ) {
    return {
      success: false,
      code: 'SELF_DEACTIVATION_NOT_ALLOWED',
      message: 'ผู้ดูแลระบบไม่สามารถปิดสิทธิ์บัญชีของตนเองได้'
    };
  }

  const scriptLock = LockService.getScriptLock();

  try {
    scriptLock.waitLock(10000);

    const accessData = getAccessSheetData();
    const targetUser = findAuthorizedUserById(accessData, normalizedUserId);

    if (!targetUser) {
      return {
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'ไม่พบบัญชีผู้ใช้งานที่ต้องการแก้ไข'
      };
    }

    accessData.sheet.getRange(
      targetUser.row_number,
      accessData.columns.is_active + 1
    ).setValue(nextIsActive);
    accessData.sheet.getRange(
      targetUser.row_number,
      accessData.columns.updated_at + 1
    ).setValue(new Date());
    accessData.sheet.getRange(
      targetUser.row_number,
      accessData.columns.updated_by + 1
    ).setValue(requestingAdmin.email);

    return {
      success: true,
      message: nextIsActive
        ? 'เปิดสิทธิ์บัญชีเรียบร้อยแล้ว'
        : 'ปิดสิทธิ์บัญชีเรียบร้อยแล้ว'
    };
  } finally {
    if (scriptLock.hasLock()) {
      scriptLock.releaseLock();
    }
  }
}

// Normalize and validate the account form before any sheet write occurs.
function normalizeRequestedUser(requestedUser) {
  const safeUser = requestedUser && typeof requestedUser === 'object'
    ? requestedUser
    : {};
  const normalizedAccess = normalizeRequestedAccess(safeUser);

  return {
    email: normalizeEmail(safeUser.email),
    customer_id: normalizedAccess.customer_id,
    role: normalizedAccess.role,
    permissions: normalizedAccess.permissions
  };
}

function normalizeRequestedAccess(requestedUser) {
  const safeUser = requestedUser && typeof requestedUser === 'object'
    ? requestedUser
    : {};

  const permissionSource =
    safeUser.permissions && typeof safeUser.permissions === 'object'
      ? safeUser.permissions
      : safeUser;
  const permissions = {
    can_withdraw:
      permissionSource.canWithdraw === true ||
      permissionSource.can_withdraw === true,
    can_receive:
      permissionSource.canReceive === true ||
      permissionSource.can_receive === true,
    is_admin:
      permissionSource.isAdmin === true ||
      permissionSource.is_admin === true
  };
  const customerId = String(safeUser.customerId || '').trim();

  return {
    permissions: permissions,
    // Internal ADMIN accounts are intentionally independent of a customer.
    customer_id: permissions.is_admin ? '' : customerId,
    // Keep a readable legacy value until the role column is retired.
    role: createLegacyRoleValue(permissions)
  };
}

// Populate the deprecated role column during migration so Sheet readers can
// still understand the account at a glance.
function createLegacyRoleValue(permissions) {
  if (permissions.is_admin) {
    return 'ADMIN';
  }

  if (permissions.can_withdraw && permissions.can_receive) {
    return 'MULTI_PERMISSION';
  }

  if (permissions.can_receive) {
    return 'RECEIVING_CHECKER';
  }

  if (permissions.can_withdraw) {
    return 'CUSTOMER_USER';
  }

  return '';
}

function validateRequestedUser(user) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(user.email)) {
    return {
      success: false,
      code: 'INVALID_EMAIL',
      message: 'กรุณากรอกอีเมลให้ถูกต้อง'
    };
  }

  return validateRequestedAccess(user);
}

function validateRequestedAccess(user) {
  const permissions = user.permissions;
  const hasAnyPermission =
    permissions.can_withdraw ||
    permissions.can_receive ||
    permissions.is_admin;

  if (!hasAnyPermission) {
    return {
      success: false,
      code: 'PERMISSION_REQUIRED',
      message: 'กรุณาเลือกสิทธิ์อย่างน้อยหนึ่งรายการ'
    };
  }

  if (
    (permissions.can_withdraw || permissions.can_receive) &&
    !permissions.is_admin &&
    !user.customer_id
  ) {
    return {
      success: false,
      code: 'CUSTOMER_REQUIRED',
      message: 'กรุณาเลือกลูกค้าสำหรับสิทธิ์ปฏิบัติงาน'
    };
  }

  return null;
}

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

// Read and validate the customer master headers used by the searchable selector.
function getCustomerMasterData() {
  const sheet = getSpreadsheet().getSheetByName(
    CONFIG.CUSTOMER_MASTER_SHEET_NAME
  );

  if (!sheet) {
    throw new Error(`Missing sheet: ${CONFIG.CUSTOMER_MASTER_SHEET_NAME}`);
  }

  const values = sheet.getDataRange().getValues();
  const headerRow = values[0] || [];
  const columns = createHeaderMap(headerRow);
  const requiredHeaders = [
    CONFIG.CUSTOMER_CODE_HEADER,
    CONFIG.CUSTOMER_NAME_HEADER
  ];

  assertRequiredHeaders(
    columns,
    requiredHeaders,
    CONFIG.CUSTOMER_MASTER_SHEET_NAME
  );

  return {
    sheet: sheet,
    values: values,
    columns: columns
  };
}

// Create a fast customer ID to customer name lookup for the admin account list.
function createCustomerNameMap() {
  const customerData = getCustomerMasterData();
  const customerNameById = {};

  for (let index = 1; index < customerData.values.length; index += 1) {
    const row = customerData.values[index];
    const customerId = String(
      row[customerData.columns[CONFIG.CUSTOMER_CODE_HEADER]] || ''
    ).trim();
    const customerName = String(
      row[customerData.columns[CONFIG.CUSTOMER_NAME_HEADER]] || ''
    ).trim();

    if (customerId) {
      customerNameById[customerId] = customerName;
    }
  }

  return customerNameById;
}

function customerIdExists(customerId) {
  const customerNameById = createCustomerNameMap();
  return Object.prototype.hasOwnProperty.call(customerNameById, customerId);
}

// Convert one access-sheet row into a normalized backend object.
function createAuthorizedUserObject(row, columns, rowNumber) {
  const legacyRole = String(row[columns.role] || '').trim().toUpperCase();

  return {
    user_id: String(row[columns.user_id] || '').trim(),
    email: normalizeEmail(row[columns.email]),
    customer_id: String(row[columns.customer_id] || '').trim(),
    role: legacyRole,
    permissions: createPermissionsFromRow(row, columns, legacyRole),
    is_active: toBoolean(row[columns.is_active]),
    row_number: rowNumber
  };
}

// Prefer explicit permission columns. Fall back to the legacy role only when
// all three permission cells are blank during the migration period.
function createPermissionsFromRow(row, columns, legacyRole) {
  const permissionValues = [
    row[columns.can_withdraw],
    row[columns.can_receive],
    row[columns.is_admin]
  ];
  const hasExplicitPermissions = permissionValues.some(function (value) {
    const normalizedValue =
      value === null || value === undefined ? '' : value;

    return String(normalizedValue).trim() !== '';
  });

  if (hasExplicitPermissions) {
    return {
      can_withdraw: toBoolean(permissionValues[0]),
      can_receive: toBoolean(permissionValues[1]),
      is_admin: toBoolean(permissionValues[2])
    };
  }

  return createPermissionsFromLegacyRole(legacyRole);
}

function createPermissionsFromLegacyRole(legacyRole) {
  return {
    can_withdraw: ['CUSTOMER_USER', 'CUSTOMER_ADMIN'].includes(legacyRole),
    can_receive: legacyRole === 'RECEIVING_CHECKER',
    is_admin: legacyRole === 'ADMIN'
  };
}

function findAuthorizedUserById(accessData, userId) {
  for (let index = 1; index < accessData.values.length; index += 1) {
    const user = createAuthorizedUserObject(
      accessData.values[index],
      accessData.columns,
      index + 1
    );

    if (user.user_id === userId) {
      return user;
    }
  }

  return null;
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

// Accept common spreadsheet representations of an active/inactive flag.
function toBoolean(value) {
  return ['true', '1', 'yes', 'y'].includes(
    String(value).trim().toLowerCase()
  );
}

// Return a deliberately limited user object to the browser.
function sanitizeUserForClient(user) {
  return {
    user_id: user.user_id,
    email: user.email,
    customer_id: user.customer_id,
    permissions: user.permissions,
    is_active: user.is_active
  };
}

function createErrorResponse(code, message) {
  return createJsonResponse({
    success: false,
    code: code,
    message: message
  });
}

// Use one consistent JSON response format for every web-app request.
function createJsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
