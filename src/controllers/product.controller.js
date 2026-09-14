const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

const slugify = (str) =>
  str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const generateUniqueProductSlug = async (name) => {
  const base = slugify(name);
  let candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  let attempts = 0;
  while (attempts < 5) {
    const exists = await prisma.product.findUnique({ where: { slug: candidate } });
    if (!exists) break;
    candidate = `${base}-${crypto.randomBytes(3).toString("hex")}`;
    attempts++;
  }
  return candidate;
};

const productInclude = {
  vendor: { select: { id: true, fullName: true, companyName: true, email: true } },
  category: { select: { id: true, name: true, slug: true } },
};

const shapeProductPayload = (body) => {
  const {
    brand, name, slug, sku, description, shortDescription, price, costPrice, discountPrice,
    stockQuantity, lowStockThreshold, status, mainImage, gallery, thumbnails, videos,
    color, size, material, weight, capacity, model, categoryId, category, supplierId, supplier,
  } = body;

  const data = {};
  if (brand !== undefined) data.brand = brand;
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (shortDescription !== undefined) data.shortDescription = shortDescription;
  if (price !== undefined) data.price = Number(price);
  if (costPrice !== undefined) data.costPrice = costPrice === null ? null : Number(costPrice);
  if (discountPrice !== undefined) data.discountPrice = discountPrice === null ? null : Number(discountPrice);
  if (stockQuantity !== undefined) data.stockQuantity = Number(stockQuantity);
  if (lowStockThreshold !== undefined) data.lowStockThreshold = Number(lowStockThreshold);
  if (status !== undefined) data.status = status;
  if (mainImage !== undefined) data.mainImage = mainImage;
  if (gallery !== undefined) data.gallery = gallery;
  if (thumbnails !== undefined) data.thumbnails = thumbnails;
  if (videos !== undefined) data.videos = videos;
  if (color !== undefined) data.color = color;
  if (size !== undefined) data.size = size;
  if (material !== undefined) data.material = material;
  if (weight !== undefined) data.weight = weight;
  if (capacity !== undefined) data.capacity = capacity;
  if (model !== undefined) data.model = model;
  if (categoryId !== undefined || category !== undefined) data.categoryId = categoryId || category;
  if (supplierId !== undefined || supplier !== undefined) data.supplierId = supplierId || supplier || null;

  return data;
};

// @desc    Get all active products for buyers (Public)
// @route   GET /api/products?vendorId=&categoryId=
exports.getAllProducts = async (req, res) => {
  try {
    const { vendorId, categoryId } = req.query;
    const where = { status: "ACTIVE" };
    if (vendorId) where.vendorId = vendorId;
    if (categoryId) where.categoryId = categoryId;

    const products = await prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ count: products.length, products });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Recommended products. Personalized from the buyer's own past
//          purchase categories when they're signed in (an optional,
//          non-blocking JWT check, this route is public); otherwise falls
//          back to popularity (top-rated, most recent) across the catalog.
// @route   GET /api/products/recommendations?limit=
exports.getRecommendations = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 8, 24);

    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer")) {
      try {
        const decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
        userId = decoded.userId || decoded.id || null;
      } catch {
        userId = null; // invalid/expired token: just fall back to generic recommendations
      }
    }

    let purchasedCategoryIds = [];
    let purchasedProductIds = [];

    if (userId) {
      const pastItems = await prisma.orderItem.findMany({
        where: { order: { userId, paymentStatus: "PAID" } },
        select: { categoryId: true, productId: true },
        take: 200,
      });
      purchasedCategoryIds = [...new Set(pastItems.map((i) => i.categoryId).filter(Boolean))];
      purchasedProductIds = [...new Set(pastItems.map((i) => i.productId).filter(Boolean))];
    }

    let recommended = [];

    if (purchasedCategoryIds.length > 0) {
      recommended = await prisma.product.findMany({
        where: {
          status: "ACTIVE",
          categoryId: { in: purchasedCategoryIds },
          id: { notIn: purchasedProductIds },
        },
        include: productInclude,
        orderBy: [{ averageRating: "desc" }, { createdAt: "desc" }],
        take: limit,
      });
    }

    if (recommended.length < limit) {
      const excludeIds = [...purchasedProductIds, ...recommended.map((p) => p.id)];
      const fill = await prisma.product.findMany({
        where: { status: "ACTIVE", id: { notIn: excludeIds } },
        include: productInclude,
        orderBy: [{ averageRating: "desc" }, { createdAt: "desc" }],
        take: limit - recommended.length,
      });
      recommended = [...recommended, ...fill];
    }

    return res.status(200).json({
      products: recommended,
      personalized: purchasedCategoryIds.length > 0,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get logged-in vendor's OWN products only
// @route   GET /api/products/vendor/me
exports.getVendorProducts = async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { vendorId: req.user.id },
      include: { category: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ count: products.length, products });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Create a product (Vendor / Admin-as-vendor)
// @route   POST /api/products
exports.createProduct = async (req, res) => {
  try {
    const data = shapeProductPayload(req.body);

    if (!data.name || !data.description || !data.categoryId || !data.mainImage || data.price === undefined) {
      return res.status(400).json({
        message: "name, description, categoryId, mainImage and price are required",
      });
    }

    const slug = await generateUniqueProductSlug(data.name);
    const publicId = `MVEC-PRD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const sku = req.body.sku || `SKU-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

    if (data.stockQuantity !== undefined && data.stockQuantity <= 0) {
      data.stockQuantity = 0;
      data.status = "OUT_OF_STOCK";
    }

    const product = await prisma.product.create({
      data: {
        ...data,
        publicId,
        slug,
        sku,
        vendorId: req.user.id,
      },
      include: productInclude,
    });

    return res.status(201).json({ message: "Product created successfully", product });
  } catch (error) {
    if (error.code === "P2002") {
      const field = error.meta?.target?.[0] || "field";
      return res.status(409).json({
        message: `A product with this ${field} already exists. Please choose a different ${field}.`,
      });
    }
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Update product (Vendor updates OWN product; Admin updates any)
// @route   PUT /api/products/:id
exports.updateProduct = async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (req.user.role !== "super_admin" && product.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Access denied. You can only update your own products." });
    }

    if (
      req.user.role === "super_admin" &&
      product.vendorId !== req.user.id &&
      req.body.stockQuantity !== undefined &&
      Number(req.body.stockQuantity) !== product.stockQuantity
    ) {
      return res.status(403).json({
        message: "Access denied. Admin is not allowed to modify vendor stock quantity.",
      });
    }

    const data = shapeProductPayload(req.body);
    // Immutable unique fields, never change from a generic update payload.
    delete data.sku;

    if (data.stockQuantity !== undefined) {
      if (data.stockQuantity <= 0) {
        data.stockQuantity = 0;
        data.status = "OUT_OF_STOCK";
      } else if (product.status === "OUT_OF_STOCK" && data.stockQuantity > 0) {
        data.status = "ACTIVE";
      }
    }

    const updated = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: productInclude,
    });

    return res.status(200).json({ message: "Product updated successfully", product: updated });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Delete product (Vendor deletes OWN product; Admin deletes any)
// @route   DELETE /api/products/:id
exports.deleteProduct = async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (req.user.role !== "super_admin" && product.vendorId !== req.user.id) {
      return res.status(403).json({ message: "Access denied. You can only delete your own products." });
    }

    await prisma.product.delete({ where: { id: req.params.id } });
    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get single product details by ID (Public)
// @route   GET /api/products/:id
exports.getProductById = async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: productInclude });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json({ product });
  } catch (error) {
    console.error("Error fetching product by ID:", error);
    return res.status(500).json({ message: "Invalid Product ID or server error" });
  }
};

// @desc    Get single product details by Slug (Public / SEO Friendly)
// @route   GET /api/products/slug/:slug
exports.getProductBySlug = async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { slug: req.params.slug }, include: productInclude });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json({ product });
  } catch (error) {
    console.error("Error fetching product by slug:", error);
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Admin: list ALL products regardless of status, paginated + searchable
// @route   GET /api/admin/products?q=&status=&page=&pageSize=
exports.adminGetProducts = async (req, res) => {
  try {
    const { q, status, page = 1, pageSize = 20 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { sku: { contains: q } },
        { brand: { contains: q } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return res.status(200).json({ data: products, meta: { page: pageNum, pageSize: limit, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
