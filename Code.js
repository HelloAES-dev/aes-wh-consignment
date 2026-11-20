/**
 * Consignment Apps Script backend.
 *
 * Phase 1 provides authenticated access using Google ID tokens and the
 * CONFIG : อีเมลที่ได้รับสิทธิ์ sheet. Business actions will be added only
 * after the authentication contract is verified.
 *
 * Required Script Properties:
 * - SPREADSHEET_ID
 * - GOOGLE_CLIENT_ID
 */

// Central configuration for the authentication phase.
// Values that may change by environment are stored in Script Properties instead
// of being hardcoded in the source file.
const CONFIG = Object.freeze({
  ACCESS_SHEET_NAME: 'CONFIG : อีเมลที่ได้รับสิทธิ์',
  REQUIRED_PROPERTIES: ['SPREADSHEET_ID', 'GOOGLE_CLIENT_ID']
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

// Main POST endpoint. Authentication is required before any business action
// is allowed to run.
function doPost(event) {
  try {
    const payload = parseRequestPayload(event);
    const identity = verifyGoogleIdToken(payload.idToken);

    if (!identity) {
      return createJsonResponse({
        success: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'A valid Google sign-in is required.'
      });
    }

    const authorizedUser = findAuthorizedUser(identity.email);

    if (!authorizedUser || !authorizedUser.is_active) {
      return createJsonResponse({
        success: false,
        code: 'ACCESS_DENIED',
        message: 'This Google account is not authorized.'
      });
    }

    // Keep the action router explicit so unsupported operations fail safely.
    switch (String(payload.action || '').trim()) {
      case 'authCheck':
        return createJsonResponse({
          success: true,
          user: sanitizeUserForClient(authorizedUser)
        });

      default:
        return createJsonResponse({
          success: false,
          code: 'UNKNOWN_ACTION',
          message: 'The requested action is not implemented yet.'
        });
    }
  } catch (error) {
    console.error('Backend request failed:', error);
    return createJsonResponse({
      success: false,
      code: 'SERVER_ERROR',
      message: 'The server could not complete the request.'
    });
  }
}

// Parse and validate the JSON request body before reading any request fields.
function parseRequestPayload(event) {
  const contents = event && event.postData && event.postData.contents;
  if (!contents) throw new Error('Request body is missing.');

  const payload = JSON.parse(contents);
  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body must be a JSON object.');
  }

  return payload;
}

// Verify the Google Identity Services ID token against Google's token-info
// endpoint, then validate the issuer, audience, email, and expiration.
function verifyGoogleIdToken(idToken) {
  if (!idToken) return null;

  const clientId = getRequiredScriptProperty('GOOGLE_CLIENT_ID');
  const response = UrlFetchApp.fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    {
      muteHttpExceptions: true
    }
  );

  if (response.getResponseCode() !== 200) return null;

  const claims = JSON.parse(response.getContentText());
  const issuer = String(claims.iss || '');
  const email = String(claims.email || '').trim().toLowerCase();
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
    email
  };
}

// Find the signed-in user in the authorized-email sheet and return only the
// fields needed by the backend and frontend.
function findAuthorizedUser(email) {
  const sheet = getSpreadsheet().getSheetByName(CONFIG.ACCESS_SHEET_NAME);
  if (!sheet) throw new Error(`Missing sheet: ${CONFIG.ACCESS_SHEET_NAME}`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;

  const columns = createHeaderMap(values[0]);
  const requiredHeaders = ['user_id', 'email', 'customer_id', 'role', 'is_active'];
  requiredHeaders.forEach((header) => {
    if (columns[header] === undefined) {
      throw new Error(`Missing access-sheet column: ${header}`);
    }
  });

  const normalizedEmail = String(email).trim().toLowerCase();

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    const rowEmail = String(row[columns.email] || '').trim().toLowerCase();
    if (rowEmail !== normalizedEmail) continue;

    return {
      user_id: String(row[columns.user_id] || '').trim(),
      email: rowEmail,
      customer_id: String(row[columns.customer_id] || '').trim(),
      role: String(row[columns.role] || '').trim().toUpperCase(),
      is_active: toBoolean(row[columns.is_active]),
      row_number: index + 1
    };
  }

  return null;
}

// Open the configured spreadsheet only when a request needs sheet data.
function getSpreadsheet() {
  return SpreadsheetApp.openById(getRequiredScriptProperty('SPREADSHEET_ID'));
}

// Read required configuration from Script Properties and fail clearly when it
// has not been configured in the Apps Script project.
function getRequiredScriptProperty(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`Missing Script Property: ${name}`);
  return value.trim();
}

// Convert the header row into a case-insensitive name-to-index lookup table.
function createHeaderMap(headerRow) {
  return headerRow.reduce((map, header, index) => {
    const normalizedHeader = String(header || '').trim().toLowerCase();
    if (normalizedHeader) map[normalizedHeader] = index;
    return map;
  }, {});
}

// Accept common spreadsheet representations of an active/inactive flag.
function toBoolean(value) {
  return ['true', '1', 'yes', 'y'].includes(String(value).trim().toLowerCase());
}

// Return a deliberately limited user object so internal sheet details are not
// exposed to the browser.
function sanitizeUserForClient(user) {
  return {
    user_id: user.user_id,
    email: user.email,
    customer_id: user.customer_id,
    role: user.role,
    is_active: user.is_active
  };
}

// Use one consistent JSON response format for every web-app request.
function createJsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
