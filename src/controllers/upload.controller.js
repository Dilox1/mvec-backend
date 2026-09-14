// src/controllers/upload.controller.js
const publicUrlFor = (req, filename) => {
  const base = process.env.PUBLIC_UPLOAD_URL || `${req.protocol}://${req.get("host")}`;
  return `${base.replace(/\/+$/, "")}/uploads/${filename}`;
};

// @desc    Upload one or more images (product photos, avatars, etc.) and get
//          back their public URLs to store as plain strings in the database.
// @route   POST /api/uploads/images   (multipart/form-data, field name "images")
// @access  Private
exports.uploadImages = async (req, res) => {
  try {
    const files = req.files || (req.file ? [req.file] : []);
    if (!files.length) {
      return res.status(400).json({ message: "No image files were received." });
    }

    const urls = files.map((f) => publicUrlFor(req, f.filename));
    return res.status(201).json({ message: "Upload successful", urls, url: urls[0] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
