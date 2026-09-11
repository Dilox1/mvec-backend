const prisma = require("../lib/prisma");

// @desc    Retrieve all translation keys and full multi-lang mappings for Admin
// @route   GET /api/admin/translations
exports.getAdminTranslations = async (req, res) => {
  try {
    const { module, search, page = 1, limit = 50 } = req.query;

    const where = {};
    if (module) where.module = module;
    if (search) {
      where.OR = [
        { key: { contains: search } },
        { en: { contains: search } },
        { rw: { contains: search } },
        { fr: { contains: search } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 50, 200);

    const [translations, total] = await Promise.all([
      prisma.translation.findMany({
        where,
        orderBy: { key: "asc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.translation.count({ where }),
    ]);

    return res.status(200).json({
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      translations,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Upsert (Create/Update) a translation key mapping
// @route   POST /api/admin/translations
exports.upsertTranslationKey = async (req, res) => {
  try {
    const { key, module, translations } = req.body;

    if (!key || !translations || !translations.en || !translations.rw || !translations.fr) {
      return res.status(400).json({
        message: "Key and translations for 'en', 'rw', and 'fr' are all required.",
      });
    }

    const updatedTranslation = await prisma.translation.upsert({
      where: { key },
      update: { module: module || "common", en: translations.en, rw: translations.rw, fr: translations.fr },
      create: {
        key,
        module: module || "common",
        en: translations.en,
        rw: translations.rw,
        fr: translations.fr,
      },
    });

    return res.status(200).json({ message: "Translation key saved successfully", translation: updatedTranslation });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
