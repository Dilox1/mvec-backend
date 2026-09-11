const express = require("express");
const router = express.Router();
const user = require("../controllers/user.controller");
const { protect, authorize } = require("../middleware/auth.middleware");

router.use(protect);

router.get("/me", user.getMyProfile);
router.patch("/me", user.updateMyProfile);

router.get("/", authorize("super_admin"), user.adminGetUsers);
router.patch("/:id/status", authorize("super_admin"), user.adminUpdateUserStatus);

module.exports = router;
