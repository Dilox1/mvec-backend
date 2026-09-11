const prisma = require("../lib/prisma");

/**
 * Evaluates the best applicable commission rule for a given product/vendor item
 */
async function getApplicableCommissionRule({ productId, vendorId, categoryId }, tx = prisma) {
  const activeRules = await tx.commissionRule.findMany({
    where: {
      isActive: true,
      OR: [
        { ruleType: "PRODUCT", targetProductId: productId || undefined },
        { ruleType: "VENDOR", targetVendorId: vendorId || undefined },
        { ruleType: "CATEGORY", targetCategoryId: categoryId || undefined },
        { ruleType: "GLOBAL" },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  if (!activeRules.length) {
    // Default fallback rule if none configured (10% platform fee)
    return { id: null, rateType: "PERCENTAGE", rateValue: 10 };
  }

  return activeRules[0];
}

/**
 * Calculates item totals, computes dynamic platform commission, and writes snapshot
 */
async function createItemPricingSnapshot({ orderId, item, tx = prisma }) {
  const { productId, vendorId, categoryId, price, quantity } = item;
  const unitPrice = price;
  const grossTotal = unitPrice * quantity;

  const rule = await getApplicableCommissionRule({ productId, vendorId, categoryId }, tx);

  let commissionAmount = 0;
  if (rule.rateType === "PERCENTAGE") {
    commissionAmount = (grossTotal * rule.rateValue) / 100;
  } else if (rule.rateType === "FIXED") {
    commissionAmount = rule.rateValue * quantity;
  }

  commissionAmount = Math.min(commissionAmount, grossTotal);
  const vendorNetEarnings = grossTotal - commissionAmount;

  const snapshot = await tx.pricingSnapshot.create({
    data: {
      orderId,
      productId,
      vendorId,
      unitPrice,
      quantity,
      grossTotal,
      commissionRuleId: rule.id || null,
      commissionRateType: rule.rateType,
      commissionRateValue: rule.rateValue,
      commissionAmount,
      vendorNetEarnings,
    },
  });

  return snapshot;
}

module.exports = { getApplicableCommissionRule, createItemPricingSnapshot };
