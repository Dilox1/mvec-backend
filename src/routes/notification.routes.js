const express = require("express");
const router = express.Router();
const notification = require("../controllers/notification.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect);

router.get("/", notification.getMyNotifications);
router.patch("/read-all", notification.markAllAsRead);
router.patch("/:id/read", notification.markAsRead);
router.delete("/:id", notification.deleteNotification);

module.exports = router;
