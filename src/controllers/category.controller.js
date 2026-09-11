const prisma = require("../lib/prisma");

const slugify = (str) =>
  str
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// ─── CREATE CATEGORY ──────────────────────────────────────────────────────
// @route   POST /api/categories
exports.createCategory = async (req, res) => {
  try {
    const { name, description, imageUrl, sortOrder, parentId } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Category name is required" });
    }

    if (parentId) {
      const parent = await prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) {
        return res.status(404).json({ message: "Parent category not found" });
      }
    }

    const slug = slugify(name);

    const existing = await prisma.category.findUnique({ where: { slug } });
    if (existing) {
      // A vendor (or anyone else) creating a category that already exists
      // should just be handed the existing one, not blocked with an error.
      return res.status(200).json({
        message: `"${existing.name}" already exists, using the existing category.`,
        alreadyExisted: true,
        category: existing,
      });
    }

    const category = await prisma.category.create({
      data: {
        name: name.trim(),
        slug,
        description,
        imageUrl,
        sortOrder: sortOrder || 0,
        parentId: parentId || null,
      },
    });

    return res.status(201).json({ message: "Category created", category });
  } catch (error) {
    console.error("Error creating category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GET ALL CATEGORIES (flat, optionally nested tree) ────────────────────
// @route   GET /api/categories?tree=true
exports.getCategories = async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { products: true } } },
    });

    if (req.query.tree === "true") {
      const byId = {};
      categories.forEach((cat) => {
        byId[cat.id] = { ...cat, children: [] };
      });

      const tree = [];
      categories.forEach((cat) => {
        if (cat.parentId && byId[cat.parentId]) {
          byId[cat.parentId].children.push(byId[cat.id]);
        } else {
          tree.push(byId[cat.id]);
        }
      });

      return res.status(200).json({ categories: tree });
    }

    return res.status(200).json({ categories });
  } catch (error) {
    console.error("Error fetching categories:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GET SINGLE CATEGORY BY SLUG ───────────────────────────────────────────
// @route   GET /api/categories/:slug
exports.getCategoryBySlug = async (req, res) => {
  try {
    const category = await prisma.category.findFirst({ where: { slug: req.params.slug, active: true } });
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const subcategories = await prisma.category.findMany({ where: { parentId: category.id, active: true } });

    return res.status(200).json({ category, subcategories });
  } catch (error) {
    console.error("Error fetching category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── UPDATE CATEGORY ────────────────────────────────────────────────────────
// @route   PATCH /api/admin/categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, imageUrl, sortOrder, active, parentId } = req.body;

    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const data = {};

    if (parentId) {
      if (parentId === id) {
        return res.status(422).json({ message: "A category cannot be its own parent" });
      }
      const parent = await prisma.category.findUnique({ where: { id: parentId } });
      if (!parent) {
        return res.status(404).json({ message: "Parent category not found" });
      }
      data.parentId = parentId;
    } else if (parentId === null) {
      data.parentId = null;
    }

    if (name && name.trim()) {
      const slug = slugify(name);
      const existing = await prisma.category.findFirst({ where: { slug, NOT: { id } } });
      if (existing) {
        return res.status(409).json({ message: "A category with this name/slug already exists" });
      }
      data.name = name.trim();
      data.slug = slug;
    }

    if (description !== undefined) data.description = description;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;
    if (active !== undefined) data.active = Boolean(active);

    const updated = await prisma.category.update({ where: { id }, data });

    return res.status(200).json({ message: "Category updated", category: updated });
  } catch (error) {
    console.error("Error updating category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── DELETE (SOFT) CATEGORY ─────────────────────────────────────────────────
// @route   DELETE /api/admin/categories/:id
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const childCount = await prisma.category.count({ where: { parentId: id, active: true } });
    if (childCount > 0) {
      return res.status(409).json({ message: "Cannot delete a category that still has active subcategories" });
    }

    const updated = await prisma.category.update({ where: { id }, data: { active: false } });

    return res.status(200).json({ message: "Category disabled", category: updated });
  } catch (error) {
    console.error("Error deleting category:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};
