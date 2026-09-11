const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { notify } = require("../utils/notify.util");

const slugify = (str) =>
  str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const generateUniqueSlug = async (name) => {
  const base = slugify(name);
  let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  let attempts = 0;
  while (attempts < 5) {
    const exists = await prisma.vendor.findUnique({ where: { slug: candidate } });
    if (!exists) break;
    candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
    attempts++;
  }
  return candidate;
};

// ─── 1. BECOME A SELLER (any authenticated user, including super_admin) ─────
// @route   POST /api/vendors/become-seller
// @access  Private (any role)
//
// This is the "Become a Seller" flow: it lets a buyer, affiliate, supplier, // or a super_admin who wants to also sell, start a Vendor profile without
// changing their primary account role. Once created, `req.user.isSellerEnabled`
// is set so the frontend can show the Vendor dashboard alongside their
// existing dashboard (e.g. the admin sidebar "Become a Seller" entry).
exports.becomeSeller = async (req, res) => {
  try {
    const existing = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
    if (existing) {
      await prisma.user.update({ where: { id: req.user.id }, data: { isSellerEnabled: true } });
      return res.status(200).json({ message: "You already have a vendor profile", vendor: existing });
    }

    const { businessName, description, phone, email, logoUrl, bannerUrl, location } = req.body;

    if (!businessName || !phone || !email) {
      return res.status(400).json({ message: "businessName, phone, and email are required" });
    }

    const slug = await generateUniqueSlug(businessName);
    const publicId = `MVEC-VND-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const vendor = await prisma.$transaction(async (tx) => {
      const created = await tx.vendor.create({
        data: {
          publicId,
          userId: req.user.id,
          businessName,
          slug,
          description,
          phone,
          email,
          logoUrl,
          bannerUrl,
          locationId: location || null,
        },
      });
      await tx.user.update({ where: { id: req.user.id }, data: { isSellerEnabled: true } });
      return created;
    });

    await notify({
      userId: req.user.id,
      type: "SYSTEM",
      title: "Welcome to MVEC selling",
      body: `Your vendor storefront "${vendor.businessName}" is now live. Add your first product to start selling.`,
      link: "/vendor",
    }).catch(() => null);

    return res.status(201).json({ message: "You are now a seller on MVEC. Welcome!", vendor });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "A vendor with this business name already exists" });
    }
    return res.status(400).json({ message: error.message });
  }
};

// ─── 1b. ONBOARD VENDOR (legacy alias, same behaviour as becomeSeller) ─────
// @route   POST /api/vendors/onboard
// @access  Private
exports.onboardVendor = exports.becomeSeller;

// ─── 2. GET OWN VENDOR PROFILE ──────────────────────────────────────────────
// @route   GET /api/vendors/me/profile
// @access  Private
exports.getMyProfile = async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
    if (!vendor) {
      return res.status(404).json({ message: "Vendor profile not found. Please complete onboarding." });
    }
    return res.status(200).json({ vendor });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 3. UPDATE OWN VENDOR PROFILE ───────────────────────────────────────────
// @route   PATCH /api/vendors/me/profile
// @access  Private
exports.updateMyProfile = async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
    if (!vendor) {
      return res.status(404).json({ message: "Vendor profile not found. Please complete onboarding." });
    }

    const { businessName, description, phone, email, logoUrl, bannerUrl, location } = req.body;
    const data = {};
    if (businessName !== undefined) data.businessName = businessName;
    if (description !== undefined) data.description = description;
    if (phone !== undefined) data.phone = phone;
    if (email !== undefined) data.email = email;
    if (logoUrl !== undefined) data.logoUrl = logoUrl;
    if (bannerUrl !== undefined) data.bannerUrl = bannerUrl;
    if (location !== undefined) data.locationId = location;

    const updated = await prisma.vendor.update({ where: { id: vendor.id }, data });
    return res.status(200).json({ message: "Vendor profile updated", vendor: updated });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "A vendor with this business name already exists" });
    }
    return res.status(400).json({ message: error.message });
  }
};

// ─── 4. PUBLIC VENDOR DIRECTORY ─────────────────────────────────────────────
// @route   GET /api/vendors?q=&location=&page=&pageSize=
// @access  Public
exports.getVendors = async (req, res) => {
  try {
    const { q, location, page = 1, pageSize = 20 } = req.query;

    const where = { status: "ACTIVE", verificationStatus: "VERIFIED" };
    if (q) where.businessName = { contains: q };
    if (location) where.locationId = location;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [vendors, total] = await Promise.all([
      prisma.vendor.findMany({
        where,
        orderBy: { ratingAvg: "desc" },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.vendor.count({ where }),
    ]);

    return res.status(200).json({ data: vendors, meta: { page: pageNum, pageSize: limit, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 5. PUBLIC VENDOR STOREFRONT ────────────────────────────────────────────
// @route   GET /api/vendors/:idOrSlug
// @access  Public
exports.getVendorByIdOrSlug = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    const vendor = await prisma.vendor.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        status: "ACTIVE",
        verificationStatus: "VERIFIED",
      },
    });

    if (!vendor) {
      return res.status(404).json({ message: "Vendor store not found" });
    }

    return res.status(200).json({ vendor });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 6. ADMIN: LIST ALL VENDORS ─────────────────────────────────────────────
// @route   GET /api/admin/vendors?status=&verificationStatus=&page=&pageSize=
// @access  Private (super_admin)
exports.adminGetVendors = async (req, res) => {
  try {
    const { status, verificationStatus, page = 1, pageSize = 20 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (verificationStatus) where.verificationStatus = verificationStatus;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [vendors, total] = await Promise.all([
      prisma.vendor.findMany({
        where,
        include: { user: { select: { fullName: true, email: true, phone: true } } },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.vendor.count({ where }),
    ]);

    return res.status(200).json({ data: vendors, meta: { page: pageNum, pageSize: limit, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 7. ADMIN: VERIFY / REJECT VENDOR ───────────────────────────────────────
// @route   PATCH /api/admin/vendors/:id/verify
// @access  Private (super_admin)
exports.adminVerifyVendor = async (req, res) => {
  try {
    const { decision } = req.body;

    if (!["VERIFIED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ message: "decision must be VERIFIED or REJECTED" });
    }

    const vendor = await prisma.vendor.update({
      where: { id: req.params.id },
      data: { verificationStatus: decision },
    });

    await notify({
      userId: vendor.userId,
      type: "SYSTEM",
      title: decision === "VERIFIED" ? "Your store is verified" : "Verification update",
      body:
        decision === "VERIFIED"
          ? `Congratulations, "${vendor.businessName}" has been verified and is now visible to buyers.`
          : `Your store "${vendor.businessName}" verification was not approved. Please contact MVEC support for details.`,
      link: "/vendor",
    }).catch(() => null);

    return res.status(200).json({ message: `Vendor ${decision.toLowerCase()}`, vendor });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Vendor not found" });
    return res.status(500).json({ message: error.message });
  }
};

// ─── 8. ADMIN: SUSPEND / ACTIVATE / BLOCK VENDOR ────────────────────────────
// @route   PATCH /api/admin/vendors/:id/status
// @access  Private (super_admin)
exports.adminUpdateVendorStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data: { status } });

    return res.status(200).json({ message: `Vendor status set to ${status}`, vendor });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Vendor not found" });
    return res.status(500).json({ message: error.message });
  }
};
