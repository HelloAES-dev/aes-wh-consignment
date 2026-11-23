/**
 * ADMIN account management and customer-master search service.
 */

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
