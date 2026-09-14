const disputeService = require("../services/dispute.service");
const socketService = require("../services/socket.service");
const prisma = require("../lib/prisma");

// @desc    List disputes, scoped by role: super_admin sees all, a vendor sees
//          disputes against their own products, a buyer sees disputes they raised
// @route   GET /api/disputes?status=&page=&pageSize=
exports.getDisputes = async (req, res) => {
  try {
    const { status, page = 1, pageSize = 20 } = req.query;

    const where = {};
    if (status) where.status = status;
    if (req.user.role === "vendor") where.vendorId = req.user.id;
    else if (req.user.role !== "super_admin") where.raisedById = req.user.id;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        include: {
          order: { select: { orderNumber: true } },
          raisedBy: { select: { fullName: true } },
          vendor: { select: { fullName: true, companyName: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.dispute.count({ where }),
    ]);

    return res.status(200).json({ data: disputes, meta: { page: pageNum, pageSize: limit, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.openDispute = async (req, res) => {
  try {
    const { orderId, reason, description, disputedAmount } = req.body;
    const raisedById = req.user.id;

    const dispute = await disputeService.openDispute({
      orderId,
      raisedById,
      reason,
      description,
      disputedAmount,
    });

    return res.status(201).json({
      success: true,
      message: "Dispute case opened successfully.",
      data: dispute,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.submitEvidence = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { message, attachments } = req.body;

    const evidence = await disputeService.submitEvidence({
      disputeId,
      userId: req.user.id,
      userRole: req.user.role,
      message,
      attachments,
    });

    // Broadcast Realtime Message to Dispute Room
    socketService.emitToRoom(`dispute:${disputeId}`, "new_evidence_submitted", evidence);

    return res.status(201).json({
      success: true,
      message: "Evidence attached to dispute successfully.",
      data: evidence,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.resolveArbitration = async (req, res) => {
  try {
    const { disputeId } = req.params;
    const { decision, buyerRefundAmount, vendorReleaseAmount, notes } = req.body;
    const adminId = req.user.id;

    const dispute = await disputeService.resolveDisputeArbitration({
      disputeId,
      adminId,
      decision,
      buyerRefundAmount,
      vendorReleaseAmount,
      notes,
    });

    // Broadcast Decision Realtime
    socketService.emitToRoom(`dispute:${disputeId}`, "dispute_resolved", dispute);

    return res.status(200).json({
      success: true,
      message: "Arbitration decision executed successfully.",
      data: dispute,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};