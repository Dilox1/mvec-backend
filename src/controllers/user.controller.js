const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");

const toPublicUser = (u) => ({
  _id: u.id,
  id: u.id,
  Fullname: u.fullName,
  email: u.email || null,
  role: u.role,
  phone: u.phone || null,
  gender: u.gender || null,
  companyName: u.companyName || null,
  isSellerEnabled: u.isSellerEnabled || false,
  accountStatus: u.accountStatus || "ACTIVE",
  createdAt: u.createdAt,
});

// @desc    Get logged-in user's own profile
// @route   GET /api/users/me
// @access  Private
exports.getMyProfile = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json({ user: toPublicUser(user) });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update logged-in user's own profile (name, gender, password)
// @route   PATCH /api/users/me
// @access  Private
exports.updateMyProfile = async (req, res) => {
  try {
    const { Fullname, gender, currentPassword, newPassword } = req.body;
    const data = {};

    if (Fullname !== undefined) data.fullName = Fullname.trim();
    if (gender !== undefined) data.gender = gender;

    if (newPassword) {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (user.password) {
        const valid = currentPassword && (await bcrypt.compare(currentPassword, user.password));
        if (!valid) {
          return res.status(400).json({ message: "Current password is incorrect" });
        }
      }
      data.password = await bcrypt.hash(newPassword, 10);
    }

    const updated = await prisma.user.update({ where: { id: req.user.id }, data });
    return res.status(200).json({ message: "Profile updated", user: toPublicUser(updated) });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Super Admin: list all users
// @route   GET /api/users?role=&page=&pageSize=
// @access  Private (super_admin)
exports.adminGetUsers = async (req, res) => {
  try {
    const { role, q, page = 1, pageSize = 20 } = req.query;
    const where = {};
    if (role) where.role = role;
    if (q) {
      where.OR = [
        { fullName: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (pageNum - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);

    return res.status(200).json({
      data: users.map(toPublicUser),
      meta: { page: pageNum, pageSize: limit, total },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Super Admin: block or unblock a user account (any role: buyer,
//          vendor, supplier, affiliate). A blocked account cannot log in and
//          any existing session token is rejected immediately. Because phone
//          and email are unique per account, blocking the account also
//          prevents that same phone/email from being used to sign in again
//          while the record exists.
// @route   PATCH /api/users/:id/status
// @access  Private (super_admin)
exports.adminUpdateUserStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;

    if (!["ACTIVE", "BLOCKED"].includes(status)) {
      return res.status(400).json({ message: "status must be ACTIVE or BLOCKED" });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) {
      return res.status(404).json({ message: "User not found" });
    }

    if (target.role === "super_admin" && status === "BLOCKED") {
      return res.status(400).json({ message: "Super Admin accounts cannot be blocked from here." });
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        accountStatus: status,
        blockedReason: status === "BLOCKED" ? reason || "Blocked by MVEC administrator" : null,
        blockedAt: status === "BLOCKED" ? new Date() : null,
        blockedById: status === "BLOCKED" ? req.user.id : null,
      },
    });

    return res.status(200).json({
      message: status === "BLOCKED" ? "User account blocked" : "User account unblocked",
      user: toPublicUser(updated),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
