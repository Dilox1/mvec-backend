const prisma = require("../lib/prisma");

exports.checkStaffPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      // Store owner or super admin always passes through
      if (req.user.role === "super_admin") return next();

      const store = await prisma.store.findUnique({ where: { vendorId: req.user.id } });
      if (store) {
        req.store = store;
        return next();
      }

      const staffMember = await prisma.staff.findFirst({
        where: { userId: req.user.id, status: "ACTIVE" },
      });
      if (!staffMember) {
        return res.status(403).json({ message: "Access denied: Not authorized as store owner or staff." });
      }

      if (requiredPermission && !staffMember[requiredPermission]) {
        return res.status(403).json({
          message: `Access denied: Missing permission [${requiredPermission}].`,
        });
      }

      req.staff = staffMember;
      req.store = await prisma.store.findUnique({ where: { id: staffMember.storeId } });
      next();
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  };
};
