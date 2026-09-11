const express = require("express");
const router = express.Router();
const { adminGetOrders } = require("../controllers/order.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

router.use(protect, authorize("super_admin"));

router.get("/", adminGetOrders); // GET /api/admin/orders

module.exports = router;
