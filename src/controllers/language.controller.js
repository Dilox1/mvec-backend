const prisma = require("../lib/prisma");

// Supported system languages
const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", flag: "🇬🇧", isDefault: true },
  { code: "rw", name: "Kinyarwanda", flag: "🇷🇼", isDefault: false },
  { code: "fr", name: "Français", flag: "🇫🇷", isDefault: false },
];

// @desc    Get supported languages & active dictionary keys for client app
// @route   GET /api/languages
exports.getLanguages = async (req, res) => {
  try {
    const { lang = "en", module } = req.query;
    const targetLang = ["en", "rw", "fr"].includes(lang) ? lang : "en";

    const where = { isApproved: true };
    if (module) where.module = module;

    const items = await prisma.translation.findMany({ where, select: { key: true, module: true, en: true, rw: true, fr: true } });

    const dictionary = {};
    items.forEach((item) => {
      dictionary[item.key] = item[targetLang] || item.en;
    });

    return res.status(200).json({
      supportedLanguages: SUPPORTED_LANGUAGES,
      currentLanguage: targetLang,
      dictionary,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
