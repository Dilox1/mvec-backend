const express = require("express");
const router = express.Router();
const supplier = require("../controllers/supplier.controller");
const { protect } = require("../middleware/auth.middleware");

// ─── PUBLIC ROUTES ──────────────────────────────────────────────────────────
router.get("/", supplier.getSuppliers);                    // GET /api/suppliers?q=&location=&page=
router.get("/:idOrSlug", supplier.getSupplierByIdOrSlug);  // GET /api/suppliers/:idOrSlug

// ─── PRIVATE: BECOME A SUPPLIER (any authenticated user) ────────────────────
router.post("/onboard", protect, supplier.onboardSupplier);
router.get("/me/profile", protect, supplier.getMyProfile);
router.patch("/me/profile", protect, supplier.updateMyProfile);

module.exports = router;
