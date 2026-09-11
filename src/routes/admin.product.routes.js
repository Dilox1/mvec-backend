const express = require("express");
const router = express.Router();
const { adminGetProducts } = require("../controllers/product.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

router.use(protect, authorize("super_admin"));

router.get("/", adminGetProducts); // GET /api/admin/products

module.exports = router;
