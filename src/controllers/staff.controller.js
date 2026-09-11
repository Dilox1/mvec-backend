const prisma = require("../lib/prisma");

// @desc    Add / Invite a staff member to store
// @route   POST /api/staff
exports.addStaffMember = async (req, res) => {
  try {
    const { email, role, permissions } = req.body;

    const store = await prisma.store.findUnique({ where: { vendorId: req.user.id } });
    if (!store) {
      return res.status(404).json({ message: "You must create a store before adding staff." });
    }

    const userToInvite = await prisma.user.findUnique({ where: { email } });
    if (!userToInvite) {
      return res.status(404).json({ message: "User with this email does not exist." });
    }

    if (userToInvite.id === req.user.id) {
      return res.status(400).json({ message: "You cannot add yourself as a staff member." });
    }

    const existingStaff = await prisma.staff.findFirst({ where: { storeId: store.id, userId: userToInvite.id } });
    if (existingStaff) {
      return res.status(400).json({ message: "User is already a staff member of this store." });
    }

    let defaultPermissions = permissions || {};
    if (role === "CATALOG_MANAGER") {
      defaultPermissions = { canManageProducts: true, canManageOrders: false, canViewAnalytics: false, canManageSettings: false, ...permissions };
    } else if (role === "ORDER_MANAGER") {
      defaultPermissions = { canManageProducts: false, canManageOrders: true, canViewAnalytics: false, canManageSettings: false, ...permissions };
    } else if (role === "STORE_MANAGER") {
      defaultPermissions = { canManageProducts: true, canManageOrders: true, canViewAnalytics: true, canManageSettings: false, ...permissions };
    }

    const staff = await prisma.staff.create({
      data: {
        storeId: store.id,
        vendorOwnerId: req.user.id,
        userId: userToInvite.id,
        role: role || "ORDER_MANAGER",
        ...defaultPermissions,
        status: "ACTIVE",
      },
    });

    return res.status(201).json({ message: "Staff member added successfully", staff });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get all staff members for logged-in vendor's store
// @route   GET /api/staff
exports.getStoreStaff = async (req, res) => {
  try {
    const store = await prisma.store.findUnique({ where: { vendorId: req.user.id } });
    if (!store) return res.status(404).json({ message: "Store not found." });

    const staffList = await prisma.staff.findMany({
      where: { storeId: store.id },
      include: { user: { select: { fullName: true, email: true, role: true } } },
    });
    return res.status(200).json({ staff: staffList });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update staff role or permissions
// @route   PUT /api/staff/:id
exports.updateStaffMember = async (req, res) => {
  try {
    const { role, permissions, status } = req.body;

    const staff = await prisma.staff.findUnique({ where: { id: req.params.id } });
    if (!staff) return res.status(404).json({ message: "Staff record not found." });

    if (staff.vendorOwnerId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized to modify this staff member." });
    }

    const data = {};
    if (role) data.role = role;
    if (status) data.status = status;
    if (permissions) Object.assign(data, permissions);

    const updated = await prisma.staff.update({ where: { id: req.params.id }, data });
    return res.status(200).json({ message: "Staff permissions updated", staff: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Remove staff member
// @route   DELETE /api/staff/:id
exports.removeStaffMember = async (req, res) => {
  try {
    const staff = await prisma.staff.findUnique({ where: { id: req.params.id } });
    if (!staff) return res.status(404).json({ message: "Staff record not found." });

    if (staff.vendorOwnerId !== req.user.id) {
      return res.status(403).json({ message: "Unauthorized to remove this staff member." });
    }

    await prisma.staff.delete({ where: { id: req.params.id } });
    return res.status(200).json({ message: "Staff member removed successfully." });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
