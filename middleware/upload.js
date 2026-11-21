const multer = require("multer");

const storage = multer.memoryStorage();

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(
    new Error(
      "Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed."
    ),
    false
  );
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
});

module.exports = upload;