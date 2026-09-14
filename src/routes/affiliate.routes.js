const express = require("express");
const router = express.Router();
const affiliateController = require("../controllers/affiliate.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

// Generate referral link
router.post("/links", protect, affiliateController.generateLink);
router.get("/links", protect, affiliateController.getMyLinks);
router.get("/wallet", protect, affiliateController.getMyWallet);
router.get("/payouts", protect, affiliateController.getMyPayouts);

// Public click tracking endpoint
router.get("/track/:code", affiliateController.trackClick);

// Request Affiliate Balance Payout (10,000 RWF Enforced)
router.post("/payouts/request", protect, affiliateController.requestPayout);

// Super Admin Payout Review and Settlement Execution
router.post(
  "/payouts/:payoutId/process",
  protect,
  authorize("super_admin"),
  affiliateController.adminProcessPayout
);

module.exports = router;