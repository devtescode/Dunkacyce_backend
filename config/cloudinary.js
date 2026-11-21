const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const UPLOAD_TIMEOUT_MS = 120000;

/**
 * Upload a multer memory buffer directly instead of expanding it into a
 * base64 data URL. The Cloudinary SDK rejects with `{ error: ... }`, so the
 * nested error is unwrapped for the controller catch blocks.
 */
cloudinary.uploadBuffer = (buffer, folder = "foods") =>
  new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder, timeout: UPLOAD_TIMEOUT_MS }, (error, result) => {
        const uploadError = error?.error ?? error;
        if (uploadError) {
          reject(uploadError);
          return;
        }
        resolve(result);
      })
      .end(buffer);
  });

module.exports = cloudinary;
