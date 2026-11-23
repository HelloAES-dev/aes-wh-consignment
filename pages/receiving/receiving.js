// Receiving outcomes control worker feedback, counters, and result styling.
const RECEIVING_RESULTS = Object.freeze({
  RECEIVED: Object.freeze({
    title: 'รับเข้าสำเร็จ',
    icon: '✓',
    style: 'success'
  }),
  DUPLICATE: Object.freeze({
    title: 'สแกนซ้ำ',
    icon: '!',
    style: 'duplicate'
  }),
  NOT_FOUND: Object.freeze({
    title: 'ไม่พบสินค้า',
    icon: '×',
    style: 'error'
  }),
  WRONG_CUSTOMER: Object.freeze({
    title: 'สินค้าไม่ตรงกับลูกค้า',
    icon: '×',
    style: 'error'
  }),
  ALREADY_WITHDRAWN: Object.freeze({
    title: 'สินค้าถูกเบิกแล้ว',
    icon: '×',
    style: 'error'
  }),
  INVALID: Object.freeze({
    title: 'ข้อมูลไม่ถูกต้อง',
    icon: '×',
    style: 'error'
  })
});

const MAX_HISTORY_ITEMS = 10;

// Return an element by ID using a descriptive helper name.
function getElementById(elementId) {
  return document.getElementById(elementId);
}

// Keep page elements together so scan handlers remain easy to follow.
const userInterface = {
  accessCard: getElementById('accessCard'),
  accessTitle: getElementById('accessTitle'),
  accessMessage: getElementById('accessMessage'),
  signInLink: getElementById('signInLink'),
  receivingApplication: getElementById('receivingApplication'),
  authenticatedEmail: getElementById('authenticatedEmail'),
  batchIdentifier: getElementById('batchIdentifier'),
  newBatchButton: getElementById('newBatchButton'),
  scannedCount: getElementById('scannedCount'),
  acceptedCount: getElementById('acceptedCount'),
  duplicateCount: getElementById('duplicateCount'),
  errorCount: getElementById('errorCount'),
  scannerForm: getElementById('scannerForm'),
  serialInput: getElementById('serialInput'),
  scanButton: getElementById('scanButton'),
  retryPanel: getElementById('retryPanel'),
  retryMessage: getElementById('retryMessage'),
  retryButton: getElementById('retryButton'),
  lastResultCard: getElementById('lastResultCard'),
  resultIcon: getElementById('resultIcon'),
  resultTitle: getElementById('resultTitle'),
  resultSerial: getElementById('resultSerial'),
  resultMessage: getElementById('resultMessage'),
  scanHistory: getElementById('scanHistory'),
  emptyHistory: getElementById('emptyHistory')
};

let currentIdToken = '';
let currentUser = null;
let receivingBatchId = '';
let pendingScan = null;
let scanHistory = [];
let scanCounts = createEmptyScanCounts();

function createEmptyScanCounts() {
  return {
    scanned: 0,
    accepted: 0,
    duplicate: 0,
    error: 0
  };
}

// Create browser-generated identifiers accepted by the backend request rules.
function createRequestIdentifier(prefix) {
  const randomValue = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

  return `${prefix}-${randomValue}`;
}

// Validate the existing same-tab session with the backend before revealing
// any receiving controls or customer-related scan results.
async function initializeReceivingPage() {
  const storedSession = window.authenticationSession.read();

  if (!storedSession) {
    showAccessFailure(
      'ยังไม่ได้ลงชื่อเข้าใช้',
      'กรุณากลับไปลงชื่อเข้าใช้ก่อนเปิดหน้าตรวจรับสินค้า'
    );
    return;
  }

  currentIdToken = storedSession.idToken;

  try {
    const result = await sendBackendRequest('authCheck');
    const permissions = result.user && result.user.permissions
      ? result.user.permissions
      : {};

    if (!permissions.can_receive) {
      showAccessFailure(
        'ไม่มีสิทธิ์ตรวจรับสินค้า',
        'บัญชีนี้ไม่ได้รับสิทธิ์สำหรับหน้าตรวจรับสินค้า'
      );
      return;
    }

    currentUser = result.user;
    window.authenticationSession.save(currentIdToken, currentUser);
    startReceivingSession();
  } catch (error) {
    console.error('Receiving authentication failed:', error);
    window.authenticationSession.clear();
    showAccessFailure(
      'เซสชันหมดอายุ',
      error.message || 'กรุณากลับไปลงชื่อเข้าใช้อีกครั้ง'
    );
  }
}

function showAccessFailure(title, message) {
  userInterface.accessTitle.textContent = title;
  userInterface.accessMessage.textContent = message;
  userInterface.accessCard.classList.remove('hidden');
  userInterface.signInLink.classList.remove('hidden');
  userInterface.receivingApplication.classList.add('hidden');
}

function startReceivingSession() {
  receivingBatchId = createRequestIdentifier('BATCH');
  scanCounts = createEmptyScanCounts();
  scanHistory = [];
  pendingScan = null;

  userInterface.authenticatedEmail.textContent = currentUser.email;
  userInterface.batchIdentifier.textContent = getShortBatchIdentifier(
    receivingBatchId
  );
  userInterface.accessCard.classList.add('hidden');
  userInterface.receivingApplication.classList.remove('hidden');
  userInterface.retryPanel.classList.add('hidden');
  userInterface.scanHistory.replaceChildren(userInterface.emptyHistory);

  updateScanCounters();
  showWaitingResult();
  setScannerBusy(false);
  focusScannerInput();
}

function getShortBatchIdentifier(batchId) {
  const suffix = batchId.split('-').pop() || batchId;
  return suffix.slice(0, 8).toUpperCase();
}

// Send authenticated JSON as text/plain to avoid an unsupported Apps Script
// OPTIONS preflight while retaining a normal JSON response contract.
async function sendBackendRequest(action, requestData = {}) {
  let response;

  try {
    response = await fetch(window.APP_CONFIG.BACKEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify({
        ...requestData,
        action: action,
        idToken: currentIdToken
      })
    });
  } catch (error) {
    throw createRequestError(
      'NETWORK_ERROR',
      'ไม่สามารถเชื่อมต่อระบบได้ กรุณาตรวจสอบอินเทอร์เน็ต',
      true
    );
  }

  if (!response.ok) {
    throw createRequestError(
      'HTTP_ERROR',
      `ระบบตอบกลับด้วยสถานะ ${response.status}`,
      response.status >= 500
    );
  }

  let result;

  try {
    result = await response.json();
  } catch (error) {
    throw createRequestError(
      'INVALID_RESPONSE',
      'ระบบส่งผลตอบกลับไม่สมบูรณ์ กรุณาลองส่งอีกครั้ง',
      true
    );
  }

  if (!result.success) {
    const retryableCodes = ['LOCK_TIMEOUT', 'SERVER_ERROR'];

    throw createRequestError(
      result.code || 'BACKEND_ERROR',
      result.message || 'ระบบไม่สามารถดำเนินการได้',
      retryableCodes.includes(result.code)
    );
  }

  return result;
}

function createRequestError(code, message, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function handleScannerSubmit(event) {
  event.preventDefault();

  if (pendingScan) {
    return;
  }

  const serialNumber = userInterface.serialInput.value.trim().toUpperCase();

  if (!serialNumber) {
    showLocalInputError('กรุณาสแกนหรือกรอกหมายเลข Serial');
    focusScannerInput();
    return;
  }

  pendingScan = {
    serialNumber: serialNumber,
    clientRequestId: createRequestIdentifier('REQ')
  };

  submitPendingScan();
}

// Keep pendingScan unchanged across uncertain network failures. A retry then
// reaches the backend with the same idempotency key and cannot duplicate data.
async function submitPendingScan() {
  if (!pendingScan) {
    return;
  }

  setScannerBusy(true);
  userInterface.retryButton.disabled = true;
  userInterface.retryPanel.classList.add('hidden');
  showProcessingResult(pendingScan.serialNumber);

  try {
    const result = await sendBackendRequest('receiveSerial', {
      serialNum: pendingScan.serialNumber,
      clientRequestId: pendingScan.clientRequestId,
      receivingBatchId: receivingBatchId
    });

    finalizeScanResult(result);
  } catch (error) {
    console.error('Receiving scan failed:', error);
    handleScanRequestFailure(error);
  }
}

function handleScanRequestFailure(error) {
  const accessFailureCodes = [
    'AUTHENTICATION_REQUIRED',
    'ACCESS_DENIED',
    'RECEIVING_PERMISSION_REQUIRED'
  ];

  if (accessFailureCodes.includes(error.code)) {
    window.authenticationSession.clear();
    pendingScan = null;
    showAccessFailure('ไม่สามารถตรวจรับสินค้าได้', error.message);
    return;
  }

  if (!error.retryable) {
    finalizeLocalFailure(error.message);
    return;
  }

  userInterface.retryMessage.textContent =
    `${error.message} ระบบจะใช้รหัสคำขอเดิมเมื่อส่งอีกครั้ง`;
  userInterface.retryPanel.classList.remove('hidden');
  userInterface.retryButton.disabled = false;
  userInterface.retryButton.focus();
}

function finalizeScanResult(result) {
  const receiving = result.receiving || {};
  const status = receiving.receiving_status || 'INVALID';
  const display = RECEIVING_RESULTS[status] || RECEIVING_RESULTS.INVALID;
  const historyEntry = {
    serialNumber: receiving.serial_num || pendingScan.serialNumber,
    status: status,
    message: result.message || display.title,
    style: display.style,
    timestamp: new Date()
  };

  scanCounts.scanned += 1;

  if (status === 'RECEIVED') {
    scanCounts.accepted += 1;
  } else if (status === 'DUPLICATE') {
    scanCounts.duplicate += 1;
  } else {
    scanCounts.error += 1;
  }

  updateScanCounters();
  showReceivingResult(historyEntry, display);
  addHistoryEntry(historyEntry);
  providePhysicalFeedback(display.style);
  finishCurrentScan();
}

function finalizeLocalFailure(message) {
  const historyEntry = {
    serialNumber: pendingScan ? pendingScan.serialNumber : '',
    status: 'INVALID',
    message: message,
    style: 'error',
    timestamp: new Date()
  };

  scanCounts.scanned += 1;
  scanCounts.error += 1;
  updateScanCounters();
  showReceivingResult(historyEntry, RECEIVING_RESULTS.INVALID);
  addHistoryEntry(historyEntry);
  providePhysicalFeedback('error');
  finishCurrentScan();
}

function finishCurrentScan() {
  pendingScan = null;
  userInterface.serialInput.value = '';
  userInterface.retryPanel.classList.add('hidden');
  setScannerBusy(false);
  focusScannerInput();
}

function setScannerBusy(isBusy) {
  userInterface.serialInput.disabled = isBusy;
  userInterface.scanButton.disabled = isBusy;
  userInterface.newBatchButton.disabled = isBusy;
  userInterface.scanButton.textContent = isBusy ? 'กำลังบันทึก...' : 'ตรวจรับ';
}

function focusScannerInput() {
  window.setTimeout(() => {
    if (!userInterface.serialInput.disabled) {
      userInterface.serialInput.focus();
    }
  }, 50);
}

function showWaitingResult() {
  setResultCardStyle('waiting');
  userInterface.resultIcon.textContent = '—';
  userInterface.resultTitle.textContent = 'พร้อมสแกน';
  userInterface.resultSerial.textContent = 'ยังไม่มีรายการ';
  userInterface.resultMessage.textContent =
    'ช่องสแกนพร้อมรับข้อมูลจากเครื่องสแกน';
}

function showProcessingResult(serialNumber) {
  setResultCardStyle('processing');
  userInterface.resultIcon.textContent = '…';
  userInterface.resultTitle.textContent = 'กำลังตรวจสอบ';
  userInterface.resultSerial.textContent = serialNumber;
  userInterface.resultMessage.textContent = 'กรุณารอผลก่อนสแกนรายการถัดไป';
}

function showLocalInputError(message) {
  setResultCardStyle('error');
  userInterface.resultIcon.textContent = '×';
  userInterface.resultTitle.textContent = 'ยังไม่มีหมายเลข Serial';
  userInterface.resultSerial.textContent = '—';
  userInterface.resultMessage.textContent = message;
}

function showReceivingResult(historyEntry, display) {
  setResultCardStyle(display.style);
  userInterface.resultIcon.textContent = display.icon;
  userInterface.resultTitle.textContent = display.title;
  userInterface.resultSerial.textContent = historyEntry.serialNumber;
  userInterface.resultMessage.textContent = historyEntry.message;
}

function setResultCardStyle(styleName) {
  userInterface.lastResultCard.className = `card result-card is-${styleName}`;
}

function updateScanCounters() {
  userInterface.scannedCount.textContent = String(scanCounts.scanned);
  userInterface.acceptedCount.textContent = String(scanCounts.accepted);
  userInterface.duplicateCount.textContent = String(scanCounts.duplicate);
  userInterface.errorCount.textContent = String(scanCounts.error);
}

function addHistoryEntry(historyEntry) {
  scanHistory.unshift(historyEntry);
  scanHistory = scanHistory.slice(0, MAX_HISTORY_ITEMS);
  renderScanHistory();
}

// Build history rows with DOM methods so scanned values are never interpreted
// as HTML.
function renderScanHistory() {
  userInterface.scanHistory.replaceChildren();

  scanHistory.forEach((entry) => {
    const item = document.createElement('li');
    const information = document.createElement('div');
    const serial = document.createElement('strong');
    const message = document.createElement('span');
    const timestamp = document.createElement('time');

    item.className = `history-item is-${entry.style}`;
    serial.textContent = entry.serialNumber;
    message.textContent = entry.message;
    timestamp.dateTime = entry.timestamp.toISOString();
    timestamp.textContent = entry.timestamp.toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    information.append(serial, message);
    item.append(information, timestamp);
    userInterface.scanHistory.append(item);
  });
}

function providePhysicalFeedback(styleName) {
  if (!window.navigator.vibrate) {
    return;
  }

  window.navigator.vibrate(styleName === 'success' ? 80 : [100, 60, 100]);
}

function confirmNewBatch() {
  const hasScans = scanCounts.scanned > 0;
  const confirmed = !hasScans || window.confirm(
    'เริ่มรอบใหม่และล้างตัวนับกับประวัติบนหน้าจอหรือไม่?'
  );

  if (confirmed) {
    startReceivingSession();
  }
}

// Register scanner interactions after the complete page markup is available.
window.addEventListener('load', initializeReceivingPage);
window.addEventListener('focus', focusScannerInput);
userInterface.scannerForm.addEventListener('submit', handleScannerSubmit);
userInterface.retryButton.addEventListener('click', submitPendingScan);
userInterface.newBatchButton.addEventListener('click', confirmNewBatch);
