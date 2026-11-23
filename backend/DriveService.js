/**
 * Google Drive photo validation and future upload integration.
 */

// Verify browser-provided file references against the configured company
// folder. File IDs alone are not trusted as proof of a completed upload.
function resolveWithdrawalPhotos(items) {
  const folderId = getRequiredScriptProperty('WITHDRAWAL_PHOTO_FOLDER_ID');
  const verifiedItems = [];
  const issues = [];

  // Confirm the folder exists before validating individual files.
  DriveApp.getFolderById(folderId).getName();

  items.forEach(function (item) {
    try {
      const file = DriveApp.getFileById(item.photo_drive_file_id);
      const mimeType = String(file.getMimeType() || '').toLowerCase();

      if (file.isTrashed()) {
        throw new Error('Photo file is in trash.');
      }

      if (!mimeType.startsWith('image/')) {
        throw new Error('Uploaded file is not an image.');
      }

      if (!isFileDirectlyInFolder(file, folderId)) {
        throw new Error('Photo file is outside the withdrawal folder.');
      }

      verifiedItems.push(Object.assign({}, item, {
        photo_drive_url: file.getUrl(),
        photo_uploaded_at: file.getDateCreated()
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

function isFileDirectlyInFolder(file, folderId) {
  const parentFolders = file.getParents();

  while (parentFolders.hasNext()) {
    if (parentFolders.next().getId() === folderId) {
      return true;
    }
  }

  return false;
}
