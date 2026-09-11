const crypto = require("crypto");
const prisma = require("../lib/prisma");

const MINIMUM_PAYOUT_RWF = 10000;

class AffiliateService {
  /**
   * Generate or retrieve affiliate referral code
   */
  async generateAffiliateLink(userId, productId = null) {
    const code = `AFF-${userId.toString().slice(-4)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    return prisma.affiliateLink.create({
      data: {
        affiliateCode: code,
        affiliateUserId: userId,
        targetProductId: productId || null,
      },
    });
  }

  /**
   * Register click with Fraud Guard (Self-referral & duplicate checks)
   */
  async trackClick(affiliateCode, visitorIp, buyerUserId = null) {
    const link = await prisma.affiliateLink.findFirst({
      where: { affiliateCode, isActive: true },
    });
    if (!link) throw new Error("Invalid or inactive affiliate link.");

    if (buyerUserId && link.affiliateUserId === buyerUserId) {
      return { fraudGuardFlagged: true, reason: "Self-referral blocked" };
    }

    await prisma.affiliateLink.update({
      where: { id: link.id },
      data: { clickCount: { increment: 1 } },
    });

    return { success: true, affiliateCode: link.affiliateCode, affiliateUser: link.affiliateUserId };
  }

  /**
   * Credit Pending Commission upon successful purchase
   */
  async creditPendingCommission({ affiliateUser, amount, orderId }) {
    return prisma.affiliateWallet.upsert({
      where: { affiliateUserId: affiliateUser },
      update: { pendingBalance: { increment: amount } },
      create: { affiliateUserId: affiliateUser, pendingBalance: amount, availableBalance: 0 },
    });
  }

  /**
   * Request Wallet Payout (Server-side 10,000 RWF Minimum Rule Enforcement)
   */
  async requestPayout({ userId, amount, paymentMethod, accountDetails }) {
    if (amount < MINIMUM_PAYOUT_RWF) {
      throw new Error(
        `Minimum withdrawal threshold is RWF ${MINIMUM_PAYOUT_RWF.toLocaleString()}. Requested: RWF ${amount.toLocaleString()}`,
      );
    }

    return prisma.$transaction(async (tx) => {
      const wallet = await tx.affiliateWallet.findUnique({ where: { affiliateUserId: userId } });
      if (!wallet || wallet.availableBalance < amount) {
        throw new Error("Insufficient available balance for withdrawal.");
      }

      await tx.affiliateWallet.update({
        where: { affiliateUserId: userId },
        data: { availableBalance: { decrement: amount } },
      });

      const payoutNumber = `PAY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

      return tx.affiliatePayout.create({
        data: {
          payoutNumber,
          affiliateUserId: userId,
          amount,
          paymentMethod,
          phoneNumber: accountDetails?.phoneNumber,
          accountName: accountDetails?.accountName,
          bankName: accountDetails?.bankName,
          accountNumber: accountDetails?.accountNumber,
          status: "PENDING",
        },
      });
    });
  }

  /**
   * Super Admin Process & Approve Payout
   */
  async processAdminPayout({ payoutId, adminId, status, transactionReference, rejectionReason }) {
    return prisma.$transaction(async (tx) => {
      const payout = await tx.affiliatePayout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new Error("Payout request not found.");

      if (payout.status !== "PENDING" && payout.status !== "PROCESSING") {
        throw new Error(`Cannot update payout in state: ${payout.status}`);
      }

      if (status === "COMPLETED") {
        await tx.affiliateWallet.update({
          where: { affiliateUserId: payout.affiliateUserId },
          data: { totalWithdrawn: { increment: payout.amount } },
        });
        return tx.affiliatePayout.update({
          where: { id: payoutId },
          data: { status: "COMPLETED", transactionReference, approvedById: adminId },
        });
      }

      if (status === "REJECTED") {
        await tx.affiliateWallet.update({
          where: { affiliateUserId: payout.affiliateUserId },
          data: { availableBalance: { increment: payout.amount } },
        });
        return tx.affiliatePayout.update({
          where: { id: payoutId },
          data: {
            status: "REJECTED",
            rejectionReason: rejectionReason || "Admin rejected payout request",
            approvedById: adminId,
          },
        });
      }

      return tx.affiliatePayout.update({ where: { id: payoutId }, data: { status } });
    });
  }
}

module.exports = new AffiliateService();
