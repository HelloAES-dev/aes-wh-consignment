/**
 * Shared Drive photo upload and validation.
 */

// Upload one browser-compressed JPEG into the configured Shared Drive folder.
// The stable upload ID makes uncertain network retries return the same file.
function uploadWithdrawalPhoto(payload, authorizedUser) {
  const request = normalizeWithdrawalPhotoUpload(payload);
  const requestError = validateWithdrawalPhotoUpload(request);

  if (requestError) {
    return requestError;
  }

  const itemResolution = resolveWithdrawalItemForUser(
    request.serial_num,
    authorizedUser
  );

  if (itemResolution.issue) {
    return {
      success: true,
      uploaded: false,
      code: itemResolution.issue.code,
      message: itemResolution.issue.message
    };
  }

  try {
    const fileName = createWithdrawalPhotoFileName(
      request.serial_num,
      authorizedUser.customer_id,
      request.photo_upload_id
    );
    const existingPhoto = findWithdrawalPhotoByUploadId(
      request.photo_upload_id,
      fileName
    );

    if (existingPhoto) {
      if (
        !isSameWithdrawalPhotoUpload(
          existingPhoto,
          request,
          authorizedUser,
          fileName
        )
      ) {
        return {
          success: false,
          code: 'PHOTO_UPLOAD_ID_CONFLICT',
          message: 'รหัสอัปโหลดรูปนี้ถูกใช้งานแล้ว กรุณาเลือกรูปอีกครั้ง'
        };
      }

      return createWithdrawalPhotoUploadResponse(existingPhoto, true);
    }

    const photoBytes = Utilities.base64Decode(request.photo_base64);

    if (
      photoBytes.length === 0 ||
      photoBytes.length > MAX_WITHDRAWAL_PHOTO_BYTES ||
      !hasJpegSignature(photoBytes)
    ) {
      return createWithdrawalPhotoUploadFailure(
        'INVALID_PHOTO_DATA',
        'ไฟล์รูปภาพไม่ถูกต้องหรือมีขนาดใหญ่เกิน 5 MB'
      );
    }

    const photoBlob = Utilities.newBlob(
      photoBytes,
      WITHDRAWAL_PHOTO_MIME_TYPE,
      fileName
    );
    const folderId = getRequiredScriptProperty(
      'WITHDRAWAL_PHOTO_FOLDER_ID'
    );
    const file = createWithdrawalPhotoFile(
      request,
      authorizedUser,
      folderId,
      fileName,
      photoBlob
    );

    return createWithdrawalPhotoUploadResponse(file, false);
  } catch (error) {
    console.error('Withdrawal photo upload failed:', error);

    return {
      success: false,
      code: 'PHOTO_UPLOAD_FAILED',
      message: 'อัปโหลดรูปภาพไม่สำเร็จ กรุณาลองอีกครั้ง'
    };
  }
}

function normalizeWithdrawalPhotoUpload(payload) {
  return {
    serial_num: String(
      payload.serialNum || payload.serial_num || ''
    ).trim().toUpperCase(),
    photo_upload_id: String(
      payload.photoUploadId || payload.photo_upload_id || ''
    ).trim(),
    photo_mime_type: String(
      payload.photoMimeType || payload.photo_mime_type || ''
    ).trim().toLowerCase(),
    photo_base64: String(
      payload.photoBase64 || payload.photo_base64 || ''
    ).trim()
  };
}

function validateWithdrawalPhotoUpload(request) {
  if (!TIRE_SERIAL_PATTERN.test(request.serial_num)) {
    return createWithdrawalPhotoUploadFailure(
      'INVALID_SERIAL_FORMAT',
      'หมายเลข Serial ต้องเป็นตัวอักษรภาษาอังกฤษหรือตัวเลข 10 ตัว'
    );
  }

  if (!REQUEST_ID_PATTERN.test(request.photo_upload_id)) {
    return createWithdrawalPhotoUploadFailure(
      'INVALID_PHOTO_UPLOAD_ID',
      'ไม่พบรหัสอัปโหลดรูปที่ถูกต้อง กรุณาเลือกรูปอีกครั้ง'
    );
  }

  if (request.photo_mime_type !== WITHDRAWAL_PHOTO_MIME_TYPE) {
    return createWithdrawalPhotoUploadFailure(
      'INVALID_PHOTO_TYPE',
      'ระบบรองรับรูปภาพ JPEG เท่านั้น'
    );
  }

  const maximumBase64Length =
    Math.ceil(MAX_WITHDRAWAL_PHOTO_BYTES * 4 / 3) + 4;

  if (
    !request.photo_base64 ||
    request.photo_base64.length > maximumBase64Length ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(request.photo_base64)
  ) {
    return createWithdrawalPhotoUploadFailure(
      'INVALID_PHOTO_DATA',
      'ไฟล์รูปภาพไม่ถูกต้องหรือมีขนาดใหญ่เกิน 5 MB'
    );
  }

  return null;
}

function createWithdrawalPhotoUploadFailure(code, message) {
  return {
    success: true,
    uploaded: false,
    code: code,
    message: message
  };
}

function hasJpegSignature(bytes) {
  return (
    bytes.length >= 3 &&
    (bytes[0] & 255) === 255 &&
    (bytes[1] & 255) === 216 &&
    (bytes[2] & 255) === 255
  );
}

function createWithdrawalPhotoFileName(serialNumber, customerId, photoUploadId) {
  const safeCustomerId = String(customerId || 'CUSTOMER')
    .replace(/[^A-Za-z0-9_-]/g, '_');
  const safePhotoUploadId = String(photoUploadId || 'UPLOAD')
    .replace(/[^A-Za-z0-9_-]/g, '_');

  return `WDR_${safeCustomerId}_${serialNumber}_${safePhotoUploadId}.jpg`;
}

function findWithdrawalPhotoByUploadId(photoUploadId, fileName) {
  const folderId = getRequiredScriptProperty('WITHDRAWAL_PHOTO_FOLDER_ID');
  const safeUploadId = escapeDriveQueryValue(photoUploadId);
  try {
    const result = Drive.Files.list({
      q: `'${folderId}' in parents and trashed = false and ` +
        `appProperties has { key='photo_upload_id' and value='${safeUploadId}' }`,
      spaces: 'drive',
      pageSize: 2,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: `files(${getWithdrawalPhotoDriveFields()})`
    });
    const files = result.files || [];

    if (files.length > 1) {
      throw new Error(`Duplicate photo upload ID: ${photoUploadId}`);
    }

    return files[0] || null;
  } catch (error) {
    // Fall back to the built-in folder service when Advanced Drive
    // authorization is unavailable in the deployed web-app runtime.
    console.warn('Advanced Drive photo lookup unavailable:', error);
    return findWithdrawalPhotoByNameWithDriveApp(folderId, fileName);
  }
}

function findWithdrawalPhotoByNameWithDriveApp(folderId, fileName) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(fileName);

  if (!files.hasNext()) {
    return null;
  }

  const file = files.next();

  if (files.hasNext()) {
    throw new Error(`Duplicate photo filename: ${fileName}`);
  }

  return normalizeDriveAppFile(file, folderId);
}

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function isSameWithdrawalPhotoUpload(
  file,
  request,
  authorizedUser,
  fileName
) {
  const properties = file.appProperties || {};

  if (properties.photo_upload_id) {
    return (
      properties.photo_upload_id === request.photo_upload_id &&
      properties.serial_num === request.serial_num &&
      properties.customer_id === authorizedUser.customer_id &&
      properties.uploaded_by_user_id === authorizedUser.user_id
    );
  }

  return file.name === fileName;
}

function getWithdrawalPhotoDriveFields() {
  return 'id,name,mimeType,webViewLink,createdTime,parents,trashed,appProperties';
}

function createWithdrawalPhotoUploadResponse(file, idempotent) {
  return {
    success: true,
    uploaded: true,
    idempotent: idempotent,
    message: idempotent
      ? 'รูปภาพนี้ถูกอัปโหลดไว้แล้ว'
      : 'อัปโหลดรูปภาพสำเร็จ',
    photo: {
      file_id: file.id,
      file_name: file.name,
      file_url: file.webViewLink ||
        `https://drive.google.com/file/d/${file.id}/view`,
      uploaded_at: file.createdTime || ''
    }
  };
}

// Prefer the Advanced Drive API for Shared Drive metadata. If the deployed
// runtime has not granted that method, use the folder service as a safe
// fallback; the file name remains deterministic for retry idempotency.
function createWithdrawalPhotoFile(
  request,
  authorizedUser,
  folderId,
  fileName,
  photoBlob
) {
  try {
    return Drive.Files.create(
      {
        name: fileName,
        mimeType: WITHDRAWAL_PHOTO_MIME_TYPE,
        parents: [folderId],
        appProperties: {
          photo_upload_id: request.photo_upload_id,
          serial_num: request.serial_num,
          customer_id: authorizedUser.customer_id,
          uploaded_by_user_id: authorizedUser.user_id
        }
      },
      photoBlob,
      {
        supportsAllDrives: true,
        fields: getWithdrawalPhotoDriveFields()
      }
    );
  } catch (error) {
    console.warn('Advanced Drive photo creation unavailable:', error);
    const folder = DriveApp.getFolderById(folderId);
    const file = folder.createFile(photoBlob);

    return normalizeDriveAppFile(file, folderId);
  }
}

function normalizeDriveAppFile(file, folderId) {
  const parentFolders = file.getParents();
  const parents = [];

  while (parentFolders.hasNext()) {
    parents.push(parentFolders.next().getId());
  }

  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    webViewLink: file.getUrl(),
    createdTime: file.getDateCreated().toISOString(),
    parents: parents,
    trashed: file.isTrashed(),
    appProperties: {}
  };
}

function getWithdrawalPhotoFolderMetadata(folderId) {
  try {
    return Drive.Files.get(folderId, {
      supportsAllDrives: true,
      fields: 'id,name,mimeType,trashed'
    });
  } catch (error) {
    console.warn('Advanced Drive folder lookup unavailable:', error);
    const folder = DriveApp.getFolderById(folderId);

    return {
      id: folder.getId(),
      name: folder.getName(),
      mimeType: 'application/vnd.google-apps.folder',
      trashed: false
    };
  }
}

// Verify browser-provided file references against the configured company
// folder. File IDs alone are not trusted as proof of a completed upload.
function resolveWithdrawalPhotos(items) {
  const folderId = getRequiredScriptProperty('WITHDRAWAL_PHOTO_FOLDER_ID');
  const verifiedItems = [];
  const issues = [];

  // Confirm the Shared Drive folder exists before validating individual files.
  getWithdrawalPhotoFolderMetadata(folderId);

  items.forEach(function (item) {
    try {
      const file = getWithdrawalPhotoFile(
        item.photo_drive_file_id,
        folderId
      );
      const mimeType = String(file.mimeType || '').toLowerCase();

      if (file.trashed) {
        throw new Error('Photo file is in trash.');
      }

      if (!mimeType.startsWith('image/')) {
        throw new Error('Uploaded file is not an image.');
      }

      if (!(file.parents || []).includes(folderId)) {
        throw new Error('Photo file is outside the withdrawal folder.');
      }

      const photoProperties = file.appProperties || {};
      const safeCustomerId = String(item.customer_id || 'CUSTOMER')
        .replace(/[^A-Za-z0-9_-]/g, '_');
      const expectedFallbackPrefix =
        `WDR_${safeCustomerId}_${item.serial_num}_`;
      const matchesBinding = photoProperties.serial_num
        ? photoProperties.serial_num === item.serial_num &&
          photoProperties.customer_id === item.customer_id
        : String(file.name || '').startsWith(expectedFallbackPrefix);

      if (!matchesBinding) {
        throw new Error('Photo file does not match the item and customer.');
      }

      verifiedItems.push(Object.assign({}, item, {
        photo_drive_url: file.webViewLink ||
          `https://drive.google.com/file/d/${file.id}/view`,
        photo_uploaded_at: file.createdTime
          ? new Date(file.createdTime)
          : new Date()
      }));
    } catch (error) {
      console.error(
        `Withdrawal photo validation failed for ${item.serial_num}:`,
        error
      );
      issues.push(createWithdrawalIssue(
        item.serial_num,
        'INVALID_WITHDRAWAL_PHOTO',
        'ไม่พบรูปภาพที่ถูกต้องของสินค้านี้ กรุณาอัปโหลดอีกครั้ง'
      ));
    }
  });

  return {
    items: verifiedItems,
    issues: issues
  };
}

function getWithdrawalPhotoFile(fileId, folderId) {
  try {
    return Drive.Files.get(fileId, {
      supportsAllDrives: true,
      fields: getWithdrawalPhotoDriveFields()
    });
  } catch (error) {
    console.warn('Advanced Drive photo metadata unavailable:', error);
    return normalizeDriveAppFile(DriveApp.getFileById(fileId), folderId);
  }
}
