const prisma = require("../lib/prisma");
const financialService = require("../services/financial.service");

// @desc    Super Admin: list real payment transactions, paginated + filterable
// @route   GET /api/admin/payments?status=&method=&q=&page=&pageSize=
exports.getAdminPayments = async (req, res) => {
  try {
    const { status, method, q, page = 1, pageSize = 20 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (method) where.method = method;
    if (q) {
      where.OR = [
        { transactionReference: { contains: q } },
        { gatewayReference: { contains: q } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: { parentOrder: { include: { user: { select: { fullName: true } } } } },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return res.status(200).json({ data: payments, meta: { page: pageNum, pageSize: limit, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Super Admin control center overview: live counts and today's activity
// @route   GET /api/admin/overview
exports.getAdminOverview = async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      totalVendors,
      totalSuppliers,
      totalAffiliates,
      totalProducts,
      ordersToday,
      revenueTodayAgg,
      pendingRefunds,
      pendingDisputes,
      pendingDeliveries,
      pendingVendorVerifications,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.vendor.count(),
      prisma.supplier.count(),
      prisma.user.count({ where: { role: "affiliate" } }),
      prisma.product.count(),
      prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: startOfToday }, paymentStatus: "PAID" },
        _sum: { totalAmount: true },
      }),
      prisma.dispute.count({ where: { status: { in: ["EVIDENCE_SUBMITTED", "UNDER_REVIEW"] } } }),
      prisma.dispute.count({ where: { status: "OPEN" } }),
      prisma.order.count({ where: { orderStatus: { in: ["CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED"] } } }),
      prisma.vendor.count({ where: { verificationStatus: "PENDING" } }),
    ]);

    const mvecCommission = await prisma.pricingSnapshot.aggregate({
      where: { createdAt: { gte: startOfToday } },
      _sum: { commissionAmount: true },
    });

    return res.status(200).json({
      overview: {
        totalUsers,
        totalVendors,
        totalSuppliers,
        totalAffiliates,
        totalProducts,
        ordersToday,
        gmvToday: revenueTodayAgg._sum.totalAmount || 0,
        mvecRevenueToday: mvecCommission._sum.commissionAmount || 0,
        pendingRefunds,
        pendingDisputes,
        pendingDeliveries,
        pendingVendorVerifications,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get all financial ledger entries with pagination & filters (Auditing)
// @route   GET /api/admin/ledger
exports.getLedgerEntries = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));

    const where = {};
    if (req.query.entryType) where.entryType = req.query.entryType;
    if (req.query.relatedOrder) where.relatedOrderId = req.query.relatedOrder;
    if (req.query.startDate || req.query.endDate) {
      where.createdAt = {};
      if (req.query.startDate) where.createdAt.gte = new Date(req.query.startDate);
      if (req.query.endDate) where.createdAt.lte = new Date(req.query.endDate);
    }

    const [entries, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        include: { debitAccount: true, creditAccount: true, relatedOrder: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ledgerEntry.count({ where }),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      count: entries.length,
      entries,
    });
  } catch (error) {
    console.error("Error fetching ledger entries:", error);
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Place Administrative Hold on Settlement
// @route   PATCH /api/admin/settlements/:id/hold
exports.placeAdminHold = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const settlement = await prisma.settlement.findUnique({ where: { id } });
    if (!settlement) {
      return res.status(404).json({ message: "Settlement not found." });
    }

    if (settlement.status !== "HELD") {
      return res.status(400).json({ message: `Cannot hold settlement with status: ${settlement.status}` });
    }

    const updated = await prisma.settlement.update({
      where: { id },
      data: {
        status: "ADMIN_HOLD",
        adminHoldReason: reason ? reason.trim() : "Administrative investigation pending",
      },
    });

    return res.status(200).json({ message: "Settlement placed on administrative hold.", settlement: updated });
  } catch (error) {
    console.error("Error placing admin hold:", error);
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Manual Escrow Release Override
// @route   POST /api/admin/settlements/:id/release
exports.manualEscrowRelease = async (req, res) => {
  const { id } = req.params;

  try {
    const settlement = await prisma.$transaction(async (tx) =>
      financialService.releaseEscrowToVendor({ settlementId: id, tx }),
    );

    return res.status(200).json({ message: "Escrow funds manually released to vendor.", settlement });
  } catch (error) {
    const isClientError = error.message.includes("not eligible") || error.message.includes("not found");
    const statusCode = isClientError ? 400 : 500;
    return res.status(statusCode).json({ message: error.message });
  }
};
