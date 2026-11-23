/**
 * Consignment Apps Script entry point and action router.
 *
 * Business logic lives in focused service files. Required Script Properties
 * are documented in Config.js and README.md.
 */

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
