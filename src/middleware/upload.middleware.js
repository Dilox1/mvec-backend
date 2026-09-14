// src/middleware/upload.middleware.js
// Real multipart file uploads (multer), saved to disk under /uploads and
// served statically by server.js. Product images used to be sent as base64
// strings inside the JSON body, which is what caused "body request too
// large" once a vendor added a few photos; this replaces that with actual
// file uploads and small URL strings in the database instead.
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, name);
  },
});

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new Error("Only JPG, PNG, WEBP or GIF images are allowed."));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 15 * 1024 * 1024, files: 10 }, // 15MB per image, up to 10 files per request
});

module.exports = { upload, UPLOAD_DIR };
