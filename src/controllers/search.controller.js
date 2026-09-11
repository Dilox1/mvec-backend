const prisma = require("../lib/prisma");

// Resolve a category that may be an id, slug or human-readable name
const resolveCategory = async (value) => {
  if (!value) return null;
  return prisma.category.findFirst({
    where: { OR: [{ id: value }, { slug: value }, { name: value }] },
    select: { id: true, name: true, slug: true },
  });
};

// Rank a product against a query. Lower score = more relevant.
function scoreProduct(p, query) {
  const s = query.toLowerCase().trim();
  const terms = s.split(/\s+/).filter(Boolean);
  const name = (p.name || "").toLowerCase();
  const brand = (p.brand || "").toLowerCase();
  const sku = (p.sku || "").toLowerCase();
  const vendorName = ((p.vendor && (p.vendor.companyName || p.vendor.fullName)) || "").toLowerCase();
  const categoryName = ((p.category && p.category.name) || "").toLowerCase();
  const description = (p.description || "").toLowerCase();

  const hasAllTerms = (str) => terms.length > 0 && terms.every((t) => str.includes(t));

  if (name === s) return 0;
  if (name.startsWith(s)) return 1;
  if (name.includes(s)) return 2;
  if (hasAllTerms(name)) return 3;
  if (brand === s || brand.includes(s)) return 4;
  if (sku.includes(s)) return 5;
  if (categoryName.includes(s) || (terms[0] && categoryName.includes(terms[0]))) return 6;
  if (vendorName.includes(s)) return 7;
  if (description.includes(s) || hasAllTerms(description)) return 8;
  return Infinity;
}

// @desc    Main paginated search with relevance ranking + related products
// @route   GET /api/search
exports.search = async (req, res) => {
  try {
    const {
      q, category, vendor, minPrice, maxPrice, rating, location, sort,
      page = 1, limit = 20, includeRelated = "true",
    } = req.query;

    const resolvedCategory = category ? await resolveCategory(category) : null;

    const where = { status: "ACTIVE" };
    if (resolvedCategory) {
      where.categoryId = resolvedCategory.id;
    } else if (category) {
      return res.status(200).json({
        meta: { total: 0, page: 1, limit: Number(limit), pages: 0 },
        products: [],
        related: [],
      });
    }

    if (vendor) {
      const matchedVendor = await prisma.user.findFirst({
        where: { OR: [{ id: vendor }, { companyName: vendor }] },
        select: { id: true },
      });
      if (matchedVendor) where.vendorId = matchedVendor.id;
      else {
        return res.status(200).json({
          meta: { total: 0, page: 1, limit: Number(limit), pages: 0 },
          products: [],
          related: [],
        });
      }
    }

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = Number(minPrice);
      if (maxPrice) where.price.lte = Number(maxPrice);
    }

    if (location) {
      const matchedVendors = await prisma.store.findMany({
        where: { addressCity: { contains: location } },
        select: { vendorId: true },
      });
      where.vendorId = { in: matchedVendors.map((v) => v.vendorId) };
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);

    let allMatches = await prisma.product.findMany({
      where,
      include: {
        vendor: { select: { companyName: true, fullName: true } },
        category: { select: { id: true, name: true, slug: true } },
      },
    });

    if (rating) {
      const min = Number(rating);
      allMatches = allMatches.filter((p) => (p.averageRating || 0) >= min || !p.averageRating);
    }

    let primary = [];
    let related = [];
    const categoriesHit = new Set();

    if (q && q.trim()) {
      const scored = allMatches
        .map((p) => ({ p, score: scoreProduct(p, q) }))
        .filter((x) => x.score !== Infinity);

      scored.sort((a, b) => a.score - b.score || (b.p.averageRating || 0) - (a.p.averageRating || 0));
      primary = scored.map((x) => x.p);
      scored.forEach((x) => x.p.category && categoriesHit.add(x.p.category.id));

      const s = q.toLowerCase().trim();
      const impliedByText = allMatches.find(
        (p) =>
          p.category &&
          (p.category.name.toLowerCase().includes(s) ||
            s.split(/\s+/).every((t) => p.category.name.toLowerCase().includes(t))),
      );
      if (impliedByText) categoriesHit.add(impliedByText.category.id);
    } else {
      primary = allMatches;
    }

    if (sort === "price_asc") primary.sort((a, b) => a.price - b.price);
    else if (sort === "price_desc") primary.sort((a, b) => b.price - a.price);
    else if (sort === "rating") primary.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));

    const total = primary.length;
    const skip = (pageNum - 1) * limitNum;
    const pageProducts = primary.slice(skip, skip + limitNum);

    if (includeRelated !== "false" && q && q.trim() && pageNum === 1) {
      const primaryIds = new Set(pageProducts.map((p) => p.id));
      related = allMatches
        .filter((p) => p.category && categoriesHit.has(p.category.id) && !primaryIds.has(p.id))
        .slice(0, 8);
    }

    return res.status(200).json({
      meta: {
        total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum),
        query: q || "", category: resolvedCategory ? resolvedCategory.name : category || "",
      },
      products: pageProducts,
      related,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Fast auto-complete / search suggestions
// @route   GET /api/search/suggestions
exports.getSuggestions = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(200).json({ suggestions: { products: [], categories: [], vendors: [] } });
    }

    const [products, categories, vendors] = await Promise.all([
      prisma.product.findMany({
        where: { name: { contains: q }, status: "ACTIVE" },
        select: { id: true, name: true, mainImage: true, price: true, slug: true, brand: true, category: { select: { name: true, slug: true } } },
        take: 20,
      }),
      prisma.category.findMany({
        where: { OR: [{ name: { contains: q } }, { slug: { contains: q } }], active: true },
        select: { name: true, slug: true },
        take: 5,
      }),
      prisma.vendor.findMany({
        where: { businessName: { contains: q }, status: "ACTIVE" },
        select: { businessName: true, logoUrl: true, slug: true },
        take: 3,
      }),
    ]);

    const ranked = products
      .map((p) => {
        const name = (p.name || "").toLowerCase();
        const s = q.toLowerCase().trim();
        let score = 3;
        if (name === s) score = 0;
        else if (name.startsWith(s)) score = 1;
        else if (name.includes(s)) score = 2;
        return { p, score };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 6)
      .map((x) => x.p);

    return res.status(200).json({ suggestions: { products: ranked, categories, vendors } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Aggregated Home Feed Data
// @route   GET /api/home
exports.getHomeFeed = async (req, res) => {
  try {
    const [categories, featuredProducts, topVendors] = await Promise.all([
      prisma.category.findMany({ where: { isFeatured: true }, take: 8 }),
      prisma.product.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ averageRating: "desc" }, { createdAt: "desc" }],
        take: 10,
        include: { vendor: { select: { companyName: true } } },
      }),
      prisma.vendor.findMany({
        where: { verificationStatus: "VERIFIED", status: "ACTIVE" },
        take: 6,
        select: { businessName: true, logoUrl: true, bannerUrl: true, ratingAvg: true },
      }),
    ]);

    return res.status(200).json({ feed: { categories, featuredProducts, topVendors } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
