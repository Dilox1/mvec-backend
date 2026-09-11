const prisma = require("../lib/prisma");

// @desc    Get my notifications (paginated) + unread count
// @route   GET /api/notifications?page=&limit=&unreadOnly=true
exports.getMyNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);

    const where = { userId: req.user.id };
    if (unreadOnly === "true") where.isRead = false;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    ]);

    return res.status(200).json({
      notifications,
      unreadCount,
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) || 1 },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Mark one notification as read
// @route   PATCH /api/notifications/:id/read
exports.markAsRead = async (req, res) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { isRead: true },
    });
    return res.status(200).json({ notification: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Mark all my notifications as read
// @route   PATCH /api/notifications/read-all
exports.markAllAsRead = async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true },
    });
    return res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Delete one of my notifications
// @route   DELETE /api/notifications/:id
exports.deleteNotification = async (req, res) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    await prisma.notification.delete({ where: { id: notification.id } });
    return res.status(200).json({ message: "Notification deleted" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
