const express = require("express");
const router = express.Router();
const vendor = require("../controllers/vendor.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

// ─── PUBLIC ROUTES ──────────────────────────────────────────────────────────
router.get("/", vendor.getVendors);                    // GET /api/vendors?q=&location=&page=
router.get("/:idOrSlug", vendor.getVendorByIdOrSlug);  // GET /api/vendors/:idOrSlug

// ─── PRIVATE: BECOME A SELLER ───────────────────────────────────────────────
// Any authenticated user, buyer, supplier, affiliate, or even a super_admin, // can start selling on MVEC without losing their existing account role.
router.post("/become-seller", protect, vendor.becomeSeller);
router.post("/onboard", protect, vendor.onboardVendor); // legacy alias

router.get("/me/profile", protect, vendor.getMyProfile);
router.patch("/me/profile", protect, vendor.updateMyProfile);

module.exports = router;
