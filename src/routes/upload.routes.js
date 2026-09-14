const express = require("express");
const router = express.Router();
const multer = require("multer");
const { protect } = require("../middleware/auth.middleware");
const { upload } = require("../middleware/upload.middleware");
const { uploadImages } = require("../controllers/upload.controller");

router.post("/images", protect, (req, res, next) => {
  upload.array("images", 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "One of your images is too large. Please use photos under 15MB each."
          : err.code === "LIMIT_FILE_COUNT"
            ? "You can upload up to 10 images at a time."
            : err.message;
      return res.status(413).json({ message });
    }
    if (err) {
      return res.status(400).json({ message: err.message || "Upload failed." });
    }
    next();
  });
}, uploadImages);

module.exports = router;
