const affiliateService = require("../services/affiliate.service");
const prisma = require("../lib/prisma");

exports.generateLink = async (req, res) => {
  try {
    const { productId } = req.body;
    const userId = req.user.id;

    const link = await affiliateService.generateAffiliateLink(userId, productId);

    return res.status(201).json({
      success: true,
      message: "Affiliate referral link created.",
      data: link,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.trackClick = async (req, res) => {
  try {
    const { code } = req.params;
    const visitorIp = req.ip;
    const buyerUserId = req.user ? req.user.id : null;

    const result = await affiliateService.trackClick(code, visitorIp, buyerUserId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.requestPayout = async (req, res) => {
  try {
    const { amount, paymentMethod, accountDetails } = req.body;
    const userId = req.user.id;

    const payout = await affiliateService.requestPayout({
      userId,
      amount,
      paymentMethod,
      accountDetails,
    });

    return res.status(201).json({
      success: true,
      message: "Payout request submitted successfully.",
      data: payout,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.adminProcessPayout = async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { status, transactionReference, rejectionReason } = req.body;
    const adminId = req.user.id;

    const updatedPayout = await affiliateService.processAdminPayout({
      payoutId,
      adminId,
      status,
      transactionReference,
      rejectionReason,
    });

    return res.status(200).json({
      success: true,
      message: `Payout request updated to ${status}.`,
      data: updatedPayout,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Get my own affiliate links with real click/conversion stats
// @route   GET /api/affiliates/links
exports.getMyLinks = async (req, res) => {
  try {
    const links = await prisma.affiliateLink.findMany({
      where: { affiliateUserId: req.user.id },
      include: { targetProduct: { select: { id: true, name: true, mainImage: true, price: true } } },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ success: true, data: links });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get my own affiliate wallet balance
// @route   GET /api/affiliates/wallet
exports.getMyWallet = async (req, res) => {
  try {
    const wallet = await prisma.affiliateWallet.upsert({
      where: { affiliateUserId: req.user.id },
      update: {},
      create: { affiliateUserId: req.user.id },
    });

    const totalEarned = wallet.pendingBalance + wallet.availableBalance + wallet.totalWithdrawn;

    return res.status(200).json({ success: true, data: { ...wallet, totalEarned } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get my own affiliate payout request history
// @route   GET /api/affiliates/payouts
exports.getMyPayouts = async (req, res) => {
  try {
    const payouts = await prisma.affiliatePayout.findMany({
      where: { affiliateUserId: req.user.id },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ success: true, data: payouts });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};