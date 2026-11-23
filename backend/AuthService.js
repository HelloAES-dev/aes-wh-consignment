/**
 * Google identity verification and authorized-user permission mapping.
 */

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
