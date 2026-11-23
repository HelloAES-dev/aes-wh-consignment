/**
 * Shared request, response, and normalization helpers.
 */

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
