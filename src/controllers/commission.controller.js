const prisma = require("../lib/prisma");

// @desc    Create a new dynamic commission rule
// @route   POST /api/admin/commissions
exports.createCommissionRule = async (req, res) => {
  try {
    const { name, ruleType, targetCategory, targetVendor, targetProduct, rateType, rateValue, priority } = req.body;

    const rule = await prisma.commissionRule.create({
      data: {
        name,
        ruleType,
        targetCategoryId: targetCategory || null,
        targetVendorId: targetVendor || null,
        targetProductId: targetProduct || null,
        rateType,
        rateValue,
        priority: priority || 0,
      },
    });

    return res.status(201).json({ success: true, message: "Commission rule created successfully.", rule });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get all commission rules
// @route   GET /api/admin/commissions
exports.getCommissionRules = async (req, res) => {
  try {
    const rules = await prisma.commissionRule.findMany({
      include: { targetCategory: true, targetProduct: true },
      orderBy: { priority: "desc" },
    });

    return res.status(200).json({ success: true, count: rules.length, rules });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Toggle rule status (Active/Inactive)
// @route   PATCH /api/admin/commissions/:id/toggle
exports.toggleCommissionRule = async (req, res) => {
  try {
    const { id } = req.params;
    const rule = await prisma.commissionRule.findUnique({ where: { id } });

    if (!rule) return res.status(404).json({ message: "Commission rule not found." });

    const updated = await prisma.commissionRule.update({
      where: { id },
      data: { isActive: !rule.isActive },
    });

    return res.status(200).json({
      message: `Rule ${updated.isActive ? "activated" : "deactivated"} successfully.`,
      rule: updated,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
