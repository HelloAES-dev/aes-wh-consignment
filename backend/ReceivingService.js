/**
 * Sugar-mill receiving transaction service.
 */

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
