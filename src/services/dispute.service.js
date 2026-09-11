const prisma = require("../lib/prisma");
const { notify } = require("../utils/notify.util");

class DisputeService {
  /**
   * Open a new dispute for an order
   */
  async openDispute({ orderId, raisedById, reason, description, disputedAmount }) {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new Error("Order not found.");

    const existing = await prisma.dispute.findFirst({
      where: { orderId, status: { not: "REJECTED" } },
    });
    if (existing) {
      throw new Error(`Active dispute already exists for this order (${existing.disputeNumber}).`);
    }

    const disputeNumber = `DSP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const dispute = await prisma.dispute.create({
      data: {
        disputeNumber,
        orderId,
        raisedById,
        vendorId: order.items[0]?.vendorId,
        reason,
        description,
        disputedAmount: disputedAmount || order.totalAmount,
        status: "OPEN",
      },
    });

    await prisma.order.update({ where: { id: orderId }, data: { paymentStatus: "DISPUTED" } });

    await notify({
      userId: dispute.vendorId,
      type: "DISPUTE",
      title: "New dispute opened",
      body: `A dispute (${dispute.disputeNumber}) was opened on order #${order.orderNumber}. Please submit evidence.`,
      link: "/vendor/refunds",
    }).catch(() => null);

    return dispute;
  }

  /**
   * Submit evidence files or chat message to a dispute
   */
  async submitEvidence({ disputeId, userId, userRole, message, attachments }) {
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new Error("Dispute not found.");

    if (
      ["RESOLVED_BUYER_REFUNDED", "RESOLVED_VENDOR_RELEASED", "RESOLVED_SPLIT", "REJECTED"].includes(
        dispute.status,
      )
    ) {
      throw new Error("Cannot submit evidence to a closed dispute.");
    }

    const evidence = await prisma.disputeEvidence.create({
      data: {
        disputeId,
        submittedById: userId,
        senderRole: userRole,
        message,
        attachments: attachments || [],
      },
    });

    if (dispute.status === "OPEN") {
      await prisma.dispute.update({ where: { id: disputeId }, data: { status: "EVIDENCE_SUBMITTED" } });
    }

    return evidence;
  }

  /**
   * Execute Binding Arbitration Decision (Super Admin Only)
   */
  async resolveDisputeArbitration({ disputeId, adminId, decision, buyerRefundAmount, vendorReleaseAmount, notes }) {
    return prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new Error("Dispute not found.");

      if (dispute.status.startsWith("RESOLVED")) {
        throw new Error("Dispute has already been resolved.");
      }

      const order = await tx.order.findUnique({ where: { id: dispute.orderId } });
      if (!order) throw new Error("Associated order not found.");

      let status = "RESOLVED_SPLIT";
      let orderPaymentStatus = order.paymentStatus;

      if (decision === "REFUND_BUYER") {
        status = "RESOLVED_BUYER_REFUNDED";
        orderPaymentStatus = "REFUNDED";
      } else if (decision === "RELEASE_TO_VENDOR") {
        status = "RESOLVED_VENDOR_RELEASED";
        orderPaymentStatus = "PAID";

        await tx.vendorWallet.upsert({
          where: { vendorId: dispute.vendorId },
          update: {
            availableBalance: { increment: dispute.disputedAmount },
            totalEarned: { increment: dispute.disputedAmount },
          },
          create: {
            vendorId: dispute.vendorId,
            availableBalance: dispute.disputedAmount,
            totalEarned: dispute.disputedAmount,
          },
        });
      } else if (decision === "SPLIT_SETTLEMENT") {
        status = "RESOLVED_SPLIT";
        if (vendorReleaseAmount > 0) {
          await tx.vendorWallet.upsert({
            where: { vendorId: dispute.vendorId },
            update: {
              availableBalance: { increment: vendorReleaseAmount },
              totalEarned: { increment: vendorReleaseAmount },
            },
            create: {
              vendorId: dispute.vendorId,
              availableBalance: vendorReleaseAmount,
              totalEarned: vendorReleaseAmount,
            },
          });
        }
      }

      const updatedDispute = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status,
          decision,
          buyerRefundAmount: buyerRefundAmount || 0,
          vendorReleaseAmount: vendorReleaseAmount || 0,
          arbitratedById: adminId,
          arbitrationNotes: notes,
          decidedAt: new Date(),
        },
      });

      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: orderPaymentStatus } });

      return updatedDispute;
    });
  }
}

module.exports = new DisputeService();
