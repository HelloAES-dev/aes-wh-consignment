/**
 * Admin ERP work queue and batch-confirmation service.
 *
 * Approval records that the separate ERP order is complete. It does not
 * control whether a customer may physically use an already withdrawn tire.
 */

// Return pending work grouped by withdrawal batch so the Admin page can show
// one order card instead of one row per tire.
function listPendingWithdrawalBatches() {
  const withdrawalLog = getWithdrawalLogStructure(getSpreadsheet());
  const pendingRecords = getWithdrawalRecordsByStatus(
    withdrawalLog,
    'SUBMITTED'
  );

  return {
    success: true,
    batches: createAdminWithdrawalBatchSummaries(pendingRecords)
  };
}

// Confirm every row in one withdrawal batch as one atomic business action.
// The short script lock prevents two Admins from approving stale data at once.
function approveWithdrawalBatch(withdrawalBatchId, authorizedUser) {
  const normalizedBatchId = String(withdrawalBatchId || '').trim();

  if (!REQUEST_ID_PATTERN.test(normalizedBatchId)) {
    return createAdminApprovalFailure(
      'INVALID_WITHDRAWAL_BATCH_ID',
      'รหัสรอบเบิกสินค้าไม่ถูกต้อง'
    );
  }

  const scriptLock = LockService.getScriptLock();

  if (!scriptLock.tryLock(10000)) {
    return createAdminApprovalFailure(
      'SYSTEM_BUSY',
      'ระบบกำลังประมวลผลรายการอื่น กรุณาลองใหม่อีกครั้ง'
    );
  }

  try {
    const withdrawalLog = getWithdrawalLogStructure(getSpreadsheet());
    const records = findWithdrawalRecordsByBatchId(
      withdrawalLog,
      normalizedBatchId
    );

    if (records.length === 0) {
      return createAdminApprovalFailure(
        'WITHDRAWAL_BATCH_NOT_FOUND',
        'ไม่พบรอบเบิกสินค้าที่ต้องการยืนยัน'
      );
    }

    const approvalState = evaluateAdminApprovalState(records);

    // A repeated request returns the existing approval without replacing the
    // original Admin identity or timestamp.
    if (approvalState === 'ALREADY_APPROVED') {
      return createAdminApprovalSuccess(records, true);
    }

    if (approvalState !== 'READY') {
      return createAdminApprovalFailure(
        'INVALID_BATCH_STATUS',
        'สถานะของรายการในรอบเบิกไม่พร้อมสำหรับการยืนยัน'
      );
    }

    const approvedAt = new Date();
    writeAdminApprovalToRows(
      withdrawalLog,
      records,
      authorizedUser,
      approvedAt
    );

    SpreadsheetApp.flush();

    records.forEach(function (record) {
      record.request_status = 'APPROVED';
      record.approved_by_user_id = authorizedUser.user_id;
      record.approved_by_email = authorizedUser.email;
      record.approved_at = approvedAt;
      record.updated_at = approvedAt;
    });

    return createAdminApprovalSuccess(records, false);
  } finally {
    scriptLock.releaseLock();
  }
}

// A batch is approvable only when every row is SUBMITTED. A fully approved
// batch is an idempotent retry; mixed or terminal statuses are rejected.
function evaluateAdminApprovalState(records) {
  const statuses = records.map(function (record) {
    return record.request_status;
  });

  if (statuses.every(function (status) {
    return status === 'APPROVED';
  })) {
    return 'ALREADY_APPROVED';
  }

  if (statuses.every(function (status) {
    return status === 'SUBMITTED';
  })) {
    return 'READY';
  }

  return 'INVALID';
}

function createAdminWithdrawalBatchSummaries(records) {
  const recordsByBatch = {};

  records.forEach(function (record) {
    if (!recordsByBatch[record.withdrawal_batch_id]) {
      recordsByBatch[record.withdrawal_batch_id] = [];
    }

    recordsByBatch[record.withdrawal_batch_id].push(record);
  });

  return Object.keys(recordsByBatch)
    .map(function (withdrawalBatchId) {
      return createAdminWithdrawalBatchSummary(
        recordsByBatch[withdrawalBatchId]
      );
    })
    .sort(function (firstBatch, secondBatch) {
      return new Date(firstBatch.submitted_at).getTime() -
        new Date(secondBatch.submitted_at).getTime();
    });
}

function createAdminWithdrawalBatchSummary(records) {
  const firstRecord = records[0];

  return {
    withdrawal_batch_id: firstRecord.withdrawal_batch_id,
    customer_id: firstRecord.customer_id,
    customer_name_snapshot: firstRecord.customer_name_snapshot,
    submitted_at: firstRecord.submitted_at,
    request_status: firstRecord.request_status,
    item_count: records.length,
    products: createWithdrawalProductSummary(records),
    items: records.map(function (record) {
      return {
        withdrawal_id: record.withdrawal_id,
        serial_num: record.serial_num,
        product_code: record.product_code,
        product_name_snapshot: record.product_name_snapshot,
        photo_drive_url: record.photo_drive_url
      };
    })
  };
}

function createAdminApprovalSuccess(records, idempotent) {
  return {
    success: true,
    approved: true,
    idempotent: idempotent,
    message: idempotent
      ? 'รอบเบิกสินค้านี้ได้รับการยืนยันแล้ว'
      : 'ยืนยันการเปิดรายการใน ERP สำเร็จ',
    batch: createAdminWithdrawalBatchSummary(records)
  };
}

function createAdminApprovalFailure(code, message) {
  return {
    success: true,
    approved: false,
    code: code,
    message: message
  };
}

// Update the complete approval span in one Sheet write. Reading and preserving
// intervening rows keeps non-adjacent batch rows safe while avoiding a partial
// APPROVED state if one of several separate write requests were to fail.
function writeAdminApprovalToRows(
  withdrawalLog,
  records,
  authorizedUser,
  approvedAt
) {
  const rowNumbers = records.map(function (record) {
    return record.row_number;
  });
  const firstRow = Math.min.apply(null, rowNumbers);
  const lastRow = Math.max.apply(null, rowNumbers);
  const firstColumn = withdrawalLog.columns.request_status + 1;
  const lastColumn = withdrawalLog.columns.updated_at + 1;
  const approvalRange = withdrawalLog.sheet.getRange(
    firstRow,
    firstColumn,
    lastRow - firstRow + 1,
    lastColumn - firstColumn + 1
  );
  const approvalValues = approvalRange.getValues();
  const rowNumberLookup = {};

  rowNumbers.forEach(function (rowNumber) {
    rowNumberLookup[rowNumber] = true;
  });

  approvalValues.forEach(function (row, index) {
    const sheetRowNumber = firstRow + index;

    if (!rowNumberLookup[sheetRowNumber]) {
      return;
    }

    row[withdrawalLog.columns.request_status - firstColumn + 1] = 'APPROVED';
    row[withdrawalLog.columns.approved_by_user_id - firstColumn + 1] =
      authorizedUser.user_id;
    row[withdrawalLog.columns.approved_by_email - firstColumn + 1] =
      authorizedUser.email;
    row[withdrawalLog.columns.approved_at - firstColumn + 1] = approvedAt;
    row[withdrawalLog.columns.updated_at - firstColumn + 1] = approvedAt;
  });

  approvalRange.setValues(approvalValues);
}
