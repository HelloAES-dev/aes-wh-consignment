/**
 * Consignment Apps Script backend.
 *
 * Phase 1 provides Google authentication and ADMIN-only account management.
 * Business transaction actions will be added after access management is
 * verified.
 *
 * Required Script Properties:
 * - SPREADSHEET_ID
 * - GOOGLE_CLIENT_ID
 */

// Central configuration keeps sheet names, headers, and allowed roles in one
// readable location. Environment-specific IDs remain in Script Properties.
const CONFIG = Object.freeze({
  ACCESS_SHEET_NAME: 'CONFIG : อีเมลที่ได้รับสิทธิ์',
  CUSTOMER_MASTER_SHEET_NAME: 'MASTER : Customer',
  CUSTOMER_CODE_HEADER: 'รหัสลูกค้า',
  CUSTOMER_NAME_HEADER: 'ชื่อลูกค้า',
  ALLOWED_ROLES: Object.freeze([
    'CUSTOMER_USER',
    'CUSTOMER_ADMIN',
    'RECEIVING_CHECKER',
    'ADMIN'
  ]),
  CUSTOMER_BOUND_ROLES: Object.freeze([
    'CUSTOMER_USER',
    'CUSTOMER_ADMIN',
    'RECEIVING_CHECKER'
  ])
});

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
  if (authorizedUser.role !== 'ADMIN' || !authorizedUser.is_active) {
    return createErrorResponse(
      'ADMIN_REQUIRED',
      'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดำเนินการนี้ได้'
    );
  }

  return createJsonResponse(actionHandler());
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
      role: user.role,
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

// Update an existing account's role and customer assignment without changing
// its Google email or deleting its audit history.
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
    role: normalizedAccess.role
  };
}

function normalizeRequestedAccess(requestedUser) {
  const safeUser = requestedUser && typeof requestedUser === 'object'
    ? requestedUser
    : {};

  const role = String(safeUser.role || '').trim().toUpperCase();
  const customerId = String(safeUser.customerId || '').trim();

  return {
    role: role,
    // System ADMIN accounts are intentionally independent of a customer.
    customer_id: role === 'ADMIN' ? '' : customerId
  };
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
  if (!CONFIG.ALLOWED_ROLES.includes(user.role)) {
    return {
      success: false,
      code: 'INVALID_ROLE',
      message: 'บทบาทผู้ใช้งานไม่ถูกต้อง'
    };
  }

  if (
    CONFIG.CUSTOMER_BOUND_ROLES.includes(user.role) &&
    !user.customer_id
  ) {
    return {
      success: false,
      code: 'CUSTOMER_REQUIRED',
      message: 'กรุณาเลือกลูกค้าสำหรับบทบาทนี้'
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
  return {
    user_id: String(row[columns.user_id] || '').trim(),
    email: normalizeEmail(row[columns.email]),
    customer_id: String(row[columns.customer_id] || '').trim(),
    role: String(row[columns.role] || '').trim().toUpperCase(),
    is_active: toBoolean(row[columns.is_active]),
    row_number: rowNumber
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
    role: user.role,
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
