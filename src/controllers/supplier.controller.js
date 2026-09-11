const crypto = require("crypto");
const prisma = require("../lib/prisma");

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
    const exists = await prisma.supplier.findUnique({ where: { slug: candidate } });
    if (!exists) break;
    candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
    attempts++;
  }
  return candidate;
};

// ─── 1. ONBOARD SUPPLIER / BECOME A SUPPLIER ────────────────────────────────
// @route   POST /api/suppliers/onboard
// @access  Private (any authenticated user, mirrors vendor "become a seller")
exports.onboardSupplier = async (req, res) => {
  try {
    const existing = await prisma.supplier.findUnique({ where: { userId: req.user.id } });
    if (existing) {
      return res.status(409).json({ message: "Supplier profile already exists" });
    }

    const { businessName, description, phone, email, logoUrl, location } = req.body;

    if (!businessName || !phone || !email) {
      return res.status(400).json({ message: "businessName, phone, and email are required" });
    }

    const slug = await generateUniqueSlug(businessName);
    const publicId = `MVEC-SUP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    const supplier = await prisma.supplier.create({
      data: {
        publicId,
        userId: req.user.id,
        businessName,
        slug,
        description,
        phone,
        email,
        logoUrl,
        locationId: location || null,
      },
    });

    return res.status(201).json({ message: "Supplier profile created", supplier });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "A supplier with this business name already exists" });
    }
    return res.status(400).json({ message: error.message });
  }
};

// ─── 2. GET OWN SUPPLIER PROFILE ────────────────────────────────────────────
exports.getMyProfile = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({ where: { userId: req.user.id } });
    if (!supplier) {
      return res.status(404).json({ message: "Supplier profile not found. Please complete onboarding." });
    }
    return res.status(200).json({ supplier });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 3. UPDATE OWN SUPPLIER PROFILE ─────────────────────────────────────────
exports.updateMyProfile = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({ where: { userId: req.user.id } });
    if (!supplier) {
      return res.status(404).json({ message: "Supplier profile not found. Please complete onboarding." });
    }

    const { businessName, description, phone, email, logoUrl, location } = req.body;
    const data = {};
    if (businessName !== undefined) data.businessName = businessName;
    if (description !== undefined) data.description = description;
    if (phone !== undefined) data.phone = phone;
    if (email !== undefined) data.email = email;
    if (logoUrl !== undefined) data.logoUrl = logoUrl;
    if (location !== undefined) data.locationId = location;

    const updated = await prisma.supplier.update({ where: { id: supplier.id }, data });
    return res.status(200).json({ message: "Supplier profile updated", supplier: updated });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "A supplier with this business name already exists" });
    }
    return res.status(400).json({ message: error.message });
  }
};

// ─── 4. PUBLIC SUPPLIER DIRECTORY ───────────────────────────────────────────
exports.getSuppliers = async (req, res) => {
  try {
    const { q, location, page = 1, pageSize = 20 } = req.query;

    const where = { status: "ACTIVE", verificationStatus: "VERIFIED" };
    if (q) where.businessName = { contains: q };
    if (location) where.locationId = location;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: { ratingAvg: "desc" },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.supplier.count({ where }),
    ]);

    return res.status(200).json({ data: suppliers, meta: { page: pageNum, pageSize: limit, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 5. PUBLIC SUPPLIER STOREFRONT ─────────────────────────────────────────
exports.getSupplierByIdOrSlug = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    const supplier = await prisma.supplier.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }], status: "ACTIVE", verificationStatus: "VERIFIED" },
    });

    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    return res.status(200).json({ supplier });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 6. ADMIN: LIST ALL SUPPLIERS ───────────────────────────────────────────
exports.adminGetSuppliers = async (req, res) => {
  try {
    const { status, verificationStatus, page = 1, pageSize = 20 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (verificationStatus) where.verificationStatus = verificationStatus;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        include: { user: { select: { fullName: true, email: true, phone: true } } },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.supplier.count({ where }),
    ]);

    return res.status(200).json({ data: suppliers, meta: { page: pageNum, pageSize: limit, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ─── 7. ADMIN: VERIFY / REJECT SUPPLIER ─────────────────────────────────────
exports.adminVerifySupplier = async (req, res) => {
  try {
    const { decision } = req.body;

    if (!["VERIFIED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ message: "decision must be VERIFIED or REJECTED" });
    }

    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: { verificationStatus: decision },
    });

    return res.status(200).json({ message: `Supplier ${decision.toLowerCase()}`, supplier });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Supplier not found" });
    return res.status(500).json({ message: error.message });
  }
};

// ─── 8. ADMIN: SUSPEND / ACTIVATE / BLOCK SUPPLIER ──────────────────────────
exports.adminUpdateSupplierStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!["ACTIVE", "SUSPENDED", "BLOCKED", "UNDER_REVIEW"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: { status } });

    return res.status(200).json({ message: `Supplier status set to ${status}`, supplier });
  } catch (error) {
    if (error.code === "P2025") return res.status(404).json({ message: "Supplier not found" });
    return res.status(500).json({ message: error.message });
  }
};
