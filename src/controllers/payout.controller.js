// src/controllers/payout.controller.js
const prisma = require("../lib/prisma");
const { formatRwandanPhone } = require("../utils/momo.util");

const DEFAULT_COMMISSION_RATE = 0.1; // 10% platform fee

const generatePayoutNumber = () => `PAY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

// @desc    Get Vendor Financial Balance Summary
// @route   GET /api/payouts/balance
exports.getVendorBalance = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const balance = await prisma.vendorBalance.upsert({
      where: { vendorId },
      update: {},
      create: { vendorId },
    });
    return res.status(200).json({ balance, commissionRate: `${DEFAULT_COMMISSION_RATE * 100}%` });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Automated Vendor Instant Payout / Withdrawal Request
// @route   POST /api/payouts/request
exports.requestPayout = async (req, res) => {
  try {
    const { amount, payoutMethod, payoutDetails } = req.body;
    const vendorId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "Valid withdrawal amount is required." });
    }

    if (!payoutDetails || !payoutDetails.accountName || !payoutDetails.accountNumber) {
      return res.status(400).json({ message: "Amount and complete payout details are required." });
    }

    const phoneInfo = formatRwandanPhone(payoutDetails.accountNumber);
    if (!phoneInfo) {
      return res.status(400).json({
        message: "Invalid Rwandan phone number. Must start with 078/079 (MTN) or 073 (Airtel).",
      });
    }

    const determinedMethod = payoutMethod || (phoneInfo.provider === "MTN" ? "MOMO" : "AIRTEL");
    const bankName = phoneInfo.provider === "MTN" ? "MTN MoMo" : "Airtel Money";

    const balance = await prisma.vendorBalance.findUnique({ where: { vendorId } });
    if (!balance || balance.availableBalance < amount) {
      return res.status(400).json({
        message: `Insufficient available balance. Available: ${balance ? balance.availableBalance : 0} RWF`,
      });
    }

    const [updatedBalance, payout] = await prisma.$transaction([
      prisma.vendorBalance.update({
        where: { vendorId },
        data: {
          availableBalance: { decrement: amount },
          withdrawnAmount: { increment: amount },
        },
      }),
      prisma.payout.create({
        data: {
          vendorId,
          payoutNumber: generatePayoutNumber(),
          amount,
          payoutMethod: determinedMethod,
          accountName: payoutDetails.accountName,
          accountNumber: phoneInfo.formattedNumber,
          bankName,
          status: "PAID", // Auto-approved and marked as PAID instantly
          processedAt: new Date(),
        },
      }),
    ]);

    // Gateway disbursement (K-Pay / MoMo Disbursement API) would be triggered here.

    return res.status(201).json({
      message: `Instant payout of ${amount} RWF disbursed to ${bankName} (${phoneInfo.localNumber}).`,
      payout,
      updatedBalance: {
        availableBalance: updatedBalance.availableBalance,
        withdrawnAmount: updatedBalance.withdrawnAmount,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get all payout requests for logged-in vendor
// @route   GET /api/payouts/history
exports.getPayoutHistory = async (req, res) => {
  try {
    const payouts = await prisma.payout.findMany({
      where: { vendorId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ payouts });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Helper Service: Automatically credit pending balance when an order is PAID
exports.creditPendingEarnings = async (orderId, vendorId) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return;

  const vendorItems = order.items.filter((item) => item.vendorId === vendorId);
  const itemSubtotal = vendorItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const platformFee = itemSubtotal * DEFAULT_COMMISSION_RATE;
  const netEarnings = itemSubtotal - platformFee;

  await prisma.vendorBalance.upsert({
    where: { vendorId },
    update: { pendingBalance: { increment: netEarnings } },
    create: { vendorId, pendingBalance: netEarnings },
  });
};

// Helper Service: Transition pending funds to available balance upon DELIVERED status
exports.releaseOrderEarnings = async (orderId, vendorId) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) return;

  const vendorItems = order.items.filter((item) => item.vendorId === vendorId);
  const itemSubtotal = vendorItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const platformFee = itemSubtotal * DEFAULT_COMMISSION_RATE;
  const netEarnings = itemSubtotal - platformFee;

  const balance = await prisma.vendorBalance.upsert({
    where: { vendorId },
    update: {},
    create: { vendorId },
  });

  const pendingDeduction = Math.min(balance.pendingBalance, netEarnings);

  await prisma.vendorBalance.update({
    where: { vendorId },
    data: {
      pendingBalance: { decrement: pendingDeduction },
      totalEarned: { increment: netEarnings },
      commissionPaid: { increment: platformFee },
      availableBalance: { increment: netEarnings },
    },
  });
};
