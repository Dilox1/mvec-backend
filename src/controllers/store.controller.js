const prisma = require("../lib/prisma");

const createSlug = (text) =>
  text.toString().toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]+/g, "").replace(/-{2,}/g, "-");

// @desc    Create a new store (Vendor / admin-as-vendor)
// @route   POST /api/stores
exports.createStore = async (req, res) => {
  try {
    const existingStore = await prisma.store.findUnique({ where: { vendorId: req.user.id } });
    if (existingStore) {
      return res.status(400).json({ message: "You already have a store profile registered." });
    }

    const { storeName, description, businessCategory, contactEmail, contactPhone, address, policies } = req.body;

    if (!storeName || !contactEmail || !contactPhone) {
      return res.status(400).json({ message: "Store name, email, and phone are required." });
    }

    const slug = createSlug(storeName);
    const slugExists = await prisma.store.findUnique({ where: { slug } });
    if (slugExists) {
      return res.status(400).json({ message: "A store with this name already exists." });
    }

    const store = await prisma.store.create({
      data: {
        vendorId: req.user.id,
        storeName,
        slug,
        description: description || "",
        businessCategory: businessCategory || "General",
        contactEmail,
        contactPhone,
        addressStreet: address?.street,
        addressCity: address?.city || "Kigali",
        addressCountry: address?.country || "Rwanda",
        returnPolicy: policies?.returnPolicy || "",
        shippingPolicy: policies?.shippingPolicy || "",
        status: "ACTIVE",
      },
    });

    return res.status(201).json({ message: "Store created successfully", store });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged-in vendor's store details
// @route   GET /api/stores/mine
exports.getMyStore = async (req, res) => {
  try {
    const store = await prisma.store.findUnique({ where: { vendorId: req.user.id } });
    if (!store) {
      return res.status(404).json({ message: "No store found for this vendor." });
    }
    return res.status(200).json({ store });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update store details (Vendor)
// @route   PUT /api/stores/mine
exports.updateMyStore = async (req, res) => {
  try {
    const store = await prisma.store.findUnique({ where: { vendorId: req.user.id } });
    if (!store) {
      return res.status(404).json({ message: "Store profile not found." });
    }

    const { status, vendor, address, policies, ...rest } = req.body;
    const data = { ...rest };
    if (address) {
      if (address.street !== undefined) data.addressStreet = address.street;
      if (address.city !== undefined) data.addressCity = address.city;
      if (address.country !== undefined) data.addressCountry = address.country;
    }
    if (policies) {
      if (policies.returnPolicy !== undefined) data.returnPolicy = policies.returnPolicy;
      if (policies.shippingPolicy !== undefined) data.shippingPolicy = policies.shippingPolicy;
    }

    const updatedStore = await prisma.store.update({ where: { id: store.id }, data });

    return res.status(200).json({ message: "Store updated successfully", store: updatedStore });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get public store profile & products by slug (Marketplace)
// @route   GET /api/stores/public/:slug
exports.getPublicStoreBySlug = async (req, res) => {
  try {
    const store = await prisma.store.findFirst({
      where: { slug: req.params.slug, status: "ACTIVE" },
      include: { vendor: { select: { fullName: true, email: true } } },
    });

    if (!store) {
      return res.status(404).json({ message: "Store not found or currently inactive." });
    }

    const products = await prisma.product.findMany({ where: { vendorId: store.vendorId, status: "ACTIVE" } });

    return res.status(200).json({ store, productsCount: products.length, products });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
