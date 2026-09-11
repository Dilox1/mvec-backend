const express = require("express");
const router = express.Router();

const {
  createCheckoutOrder,
  directCheckout,
  getMyOrders,
  getOrderById,
  getVendorOrders,
  getDeliverableOrders,
  updateVendorOrderStatus,
  updateOrderStatus,
  confirmOrderDelivery,
  cancelOrder,
} = require("../controllers/order.controller");

const { checkStaffPermission } = require("../middleware/staff.middleware");
const { protect, authorize } = require("../middleware/auth.middleware");

// Require authentication for all order routes
router.use(protect);

router.post("/checkout", createCheckoutOrder);
router.post("/direct-checkout", directCheckout);
router.get("/my-orders", getMyOrders);
router.get("/vendor/orders", authorize("vendor"), getVendorOrders);
router.get("/deliverable", authorize("vendor", "delivery", "super_admin"), getDeliverableOrders);

router.patch("/vendor/status", authorize("vendor", "super_admin"), updateVendorOrderStatus);
router.patch("/vendor/status", checkStaffPermission("canManageOrders"), updateVendorOrderStatus);

router.patch("/:id/cancel", cancelOrder);
router.patch("/:id/deliver", authorize("vendor", "delivery", "super_admin"), confirmOrderDelivery);
router.patch("/:id/status", authorize("vendor", "super_admin"), updateOrderStatus);

// Kept last: this is a wildcard match on order id, so it must not shadow the
// more specific routes above (e.g. /deliverable, /vendor/orders).
router.get("/:id", getOrderById);

module.exports = router;
