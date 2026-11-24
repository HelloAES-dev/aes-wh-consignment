/**
 * Google Chat withdrawal notification service.
 *
 * The withdrawal transaction is committed before this service runs. Chat is a
 * one-way notification channel and must never become the source of truth.
 */

// Make exactly one delivery attempt for a newly committed withdrawal batch,
// then persist SENT or FAILED without throwing away the business transaction.
function notifyWithdrawalBatchOnce(records) {
  const deliveryResult = sendWithdrawalBatchToGoogleChat(records);
  const firstRecord = records[0];
  let persisted = false;

  try {
    persisted = persistWithdrawalChatNotificationResult(
      firstRecord.withdrawal_batch_id,
      firstRecord.client_request_id,
      deliveryResult
    );
  } catch (error) {
    console.error('Chat result persistence failed:', error);
  }

  // A sent message with an unpersisted result is uncertain. Keep PENDING so
  // the system never claims either SENT or FAILED without an audited Sheet row.
  const finalResult = persisted
    ? deliveryResult
    : createPendingChatNotificationResult();

  applyChatNotificationResultToRecords(records, finalResult);
  return finalResult;
}

function sendWithdrawalBatchToGoogleChat(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return createFailedChatNotificationResult('EMPTY_WITHDRAWAL_BATCH');
  }

  try {
    const webhookUrl = getGoogleChatWebhookUrl();
    const message = createWithdrawalChatMessage(records);
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify(message),
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();

    if (responseCode < 200 || responseCode >= 300) {
      console.error(
        `Google Chat webhook failed with HTTP ${responseCode}: ` +
        getSafeChatErrorBody(response)
      );
      return createFailedChatNotificationResult(
        `GOOGLE_CHAT_HTTP_${responseCode}`
      );
    }

    return createSentChatNotificationResult(
      readGoogleChatMessageName(response)
    );
  } catch (error) {
    console.error('Google Chat notification failed:', error);
    return createFailedChatNotificationResult('GOOGLE_CHAT_REQUEST_FAILED');
  }
}

// Build one compact card per withdrawal batch. Photos and serial numbers stay
// inside the authenticated Admin page to keep Chat fast and minimal.
function createWithdrawalChatMessage(records) {
  const firstRecord = records[0];
  const productSummary = createWithdrawalProductSummary(records);
  const adminUrl = createAdminErpBatchUrl(firstRecord.withdrawal_batch_id);
  const customerCode = getChatDisplayValue(
    firstRecord.customer_id,
    'ไม่ระบุรหัสลูกค้า'
  );
  const customerName = getChatDisplayValue(
    firstRecord.customer_name_snapshot,
    'ไม่ระบุชื่อลูกค้า'
  );
  const submittedAt = formatChatBangkokDate(firstRecord.submitted_at);
  const productWidgets = productSummary.map(function (product) {
    const productCode = getChatDisplayValue(
      product.product_code,
      'ไม่ระบุรหัสสินค้า'
    );
    const productName = getChatDisplayValue(
      product.product_name_snapshot,
      'ไม่ระบุชื่อสินค้า'
    );

    return {
      decoratedText: {
        topLabel: escapeGoogleChatText(productCode),
        text: escapeGoogleChatText(
          `${productName} · ${product.quantity} เส้น`
        ),
        wrapText: true
      }
    };
  });

  return {
    text: `ORDER FROM CONSIGNMENT: ${customerCode} (${records.length} เส้น)`,
    cardsV2: [
      {
        cardId: 'consignment-withdrawal',
        card: {
          header: {
            title: 'ORDER FROM CONSIGNMENT',
            subtitle: `${escapeGoogleChatText(customerCode)} · ` +
              escapeGoogleChatText(customerName)
          },
          sections: [
            {
              header: 'รายการสินค้า',
              widgets: productWidgets
            },
            {
              widgets: [
                {
                  decoratedText: {
                    topLabel: 'จำนวนรวม',
                    text: `${records.length} เส้น`
                  }
                },
                {
                  decoratedText: {
                    topLabel: 'ส่งรายการเมื่อ',
                    text: escapeGoogleChatText(submittedAt)
                  }
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'เปิดหน้าตรวจสอบออเดอร์',
                        onClick: {
                          openLink: {
                            url: adminUrl
                          }
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      }
    ]
  };
}

function getGoogleChatWebhookUrl() {
  const webhookUrl = getRequiredScriptProperty('GOOGLE_CHAT_WEBHOOK_URL');

  if (!webhookUrl.startsWith('https://chat.googleapis.com/')) {
    throw new Error('Invalid GOOGLE_CHAT_WEBHOOK_URL Script Property');
  }

  return webhookUrl;
}

function createAdminErpBatchUrl(withdrawalBatchId) {
  const baseUrl = getRequiredScriptProperty('ADMIN_ERP_BASE_URL');

  if (!baseUrl.startsWith('https://')) {
    throw new Error('Invalid ADMIN_ERP_BASE_URL Script Property');
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}batch=${encodeURIComponent(withdrawalBatchId)}`;
}

function getChatDisplayValue(value, fallback) {
  const normalizedValue = String(value || '').trim();
  return normalizedValue || fallback;
}

// Chat decorated text supports limited markup, so Sheet values must be
// escaped before becoming card content.
function escapeGoogleChatText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatChatBangkokDate(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'ไม่ระบุวันและเวลา';
  }

  return Utilities.formatDate(
    date,
    'Asia/Bangkok',
    'dd/MM/yyyy HH:mm'
  );
}

function readGoogleChatMessageName(response) {
  try {
    const body = JSON.parse(response.getContentText() || '{}');
    return String(body.name || '').trim();
  } catch (error) {
    // A successful HTTP response means Chat accepted the message even if its
    // optional response body cannot be parsed.
    return '';
  }
}

function getSafeChatErrorBody(response) {
  return String(response.getContentText() || '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);
}

function createSentChatNotificationResult(messageName) {
  return {
    status: 'SENT',
    notified_at: new Date(),
    message_name: String(messageName || '').trim(),
    error_code: ''
  };
}

function createFailedChatNotificationResult(errorCode) {
  return {
    status: 'FAILED',
    notified_at: '',
    message_name: '',
    error_code: errorCode
  };
}

function createPendingChatNotificationResult() {
  return {
    status: 'PENDING',
    notified_at: '',
    message_name: '',
    error_code: 'CHAT_RESULT_NOT_PERSISTED'
  };
}

// Persist the network result under the same script lock used by Admin approval
// so the two operations cannot overwrite each other's audit columns.
function persistWithdrawalChatNotificationResult(
  withdrawalBatchId,
  clientRequestId,
  notificationResult
) {
  const scriptLock = LockService.getScriptLock();

  if (!scriptLock.tryLock(10000)) {
    console.error('Could not acquire lock to persist Google Chat result.');
    return false;
  }

  try {
    const withdrawalLog = getWithdrawalLogStructure(getSpreadsheet());
    const records = findWithdrawalRecordsByBatchId(
      withdrawalLog,
      withdrawalBatchId
    );

    if (
      records.length === 0 ||
      records.some(function (record) {
        return record.client_request_id !== clientRequestId;
      })
    ) {
      console.error('Withdrawal batch changed before Chat status persistence.');
      return false;
    }

    writeWithdrawalChatResultToRows(
      withdrawalLog,
      records,
      notificationResult
    );
    SpreadsheetApp.flush();
    return true;
  } finally {
    scriptLock.releaseLock();
  }
}

// Write all Chat audit fields in one Sheet operation while preserving any
// unrelated or non-adjacent rows between the first and last batch row.
function writeWithdrawalChatResultToRows(
  withdrawalLog,
  records,
  notificationResult
) {
  const rowNumbers = records.map(function (record) {
    return record.row_number;
  });
  const firstRow = Math.min.apply(null, rowNumbers);
  const lastRow = Math.max.apply(null, rowNumbers);
  const firstColumn = withdrawalLog.columns.chat_notification_status + 1;
  const lastColumn = withdrawalLog.columns.updated_at + 1;
  const chatRange = withdrawalLog.sheet.getRange(
    firstRow,
    firstColumn,
    lastRow - firstRow + 1,
    lastColumn - firstColumn + 1
  );
  const chatValues = chatRange.getValues();
  const rowNumberLookup = {};
  const updatedAt = new Date();

  rowNumbers.forEach(function (rowNumber) {
    rowNumberLookup[rowNumber] = true;
  });

  chatValues.forEach(function (row, index) {
    const sheetRowNumber = firstRow + index;

    if (!rowNumberLookup[sheetRowNumber]) {
      return;
    }

    row[
      withdrawalLog.columns.chat_notification_status - firstColumn + 1
    ] = notificationResult.status;
    row[
      withdrawalLog.columns.chat_notified_at - firstColumn + 1
    ] = notificationResult.notified_at;
    row[
      withdrawalLog.columns.chat_message_name - firstColumn + 1
    ] = notificationResult.message_name;
    row[withdrawalLog.columns.updated_at - firstColumn + 1] = updatedAt;
  });

  chatRange.setValues(chatValues);
}

function applyChatNotificationResultToRecords(records, notificationResult) {
  const updatedAt = new Date();

  records.forEach(function (record) {
    record.chat_notification_status = notificationResult.status;
    record.chat_notified_at = notificationResult.notified_at;
    record.chat_message_name = notificationResult.message_name;
    record.updated_at = updatedAt;
  });
}
