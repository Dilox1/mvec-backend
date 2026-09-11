const cron = require("node-cron");
const prisma = require("../lib/prisma");

/**
 * 1. 30-Minute Unpaid Order Cancellation Worker
 * Runs every minute to find PENDING (unpaid) orders created > 30 mins ago.
 */
const cancelExpiredUnpaidOrders = async () => {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

  try {
    const expiredOrders = await prisma.order.findMany({
      where: {
        paymentStatus: "PENDING",
        orderStatus: { in: ["PENDING", "PROCESSING"] },
        createdAt: { lte: thirtyMinutesAgo },
      },
      include: { items: true },
    });

    for (const order of expiredOrders) {
      try {
        await prisma.$transaction(async (tx) => {
          const freshOrder = await tx.order.findUnique({ where: { id: order.id } });
          if (!freshOrder || freshOrder.paymentStatus === "PAID" || freshOrder.orderStatus === "CANCELLED") {
            return;
          }

          await tx.order.update({
            where: { id: order.id },
            data: { orderStatus: "CANCELLED", cancellationReason: "PAYMENT_TIMEOUT_EXPIRED_30_MIN" },
          });

          await tx.payment.updateMany({
            where: { parentOrderId: order.id, status: "PENDING" },
            data: { status: "CANCELLED" },
          });

          for (const item of order.items) {
            if (!item.productId) continue;
            await tx.product.update({
              where: { id: item.productId },
              data: { stockQuantity: { increment: item.quantity } },
            });
          }
        });

        console.log(`[Expiry Worker] Successfully auto-cancelled expired Order #${order.id}`);
      } catch (err) {
        console.error(`[Expiry Worker] Failed to cancel order #${order.id}:`, err.message);
      }
    }
  } catch (error) {
    console.error("[Expiry Worker] Error fetching expired orders:", error.message);
  }
};

/**
 * 2. 3-Hour Vendor Fulfillment SLA Enforcer Worker
 * Runs every 15 minutes to flag orders awaiting vendor dispatch > 3 hours after payment.
 */
const enforceFulfillmentSLA = async () => {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);

  try {
    const slaBreachedOrders = await prisma.order.findMany({
      where: {
        paymentStatus: "PAID",
        orderStatus: "PROCESSING",
        slaBreached: false,
        updatedAt: { lte: threeHoursAgo },
      },
      include: { items: true },
    });

    for (const order of slaBreachedOrders) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          slaBreached: true,
          slaBreachedAt: new Date(),
          adminNotes: `${order.adminNotes || ""} | SLA Breached: Vendor failed to dispatch within 3 hours.`,
        },
      });

      const vendorIds = [...new Set(order.items.map((i) => i.vendorId).filter(Boolean))];
      console.warn(`[SLA Worker] SLA BREACH FLAGGED for Order #${order.id} (Vendors: ${vendorIds.join(", ")})`);
    }
  } catch (error) {
    console.error("[SLA Worker] Error running SLA audit:", error.message);
  }
};

/**
 * Initialize Background Jobs
 */
exports.initBackgroundWorkers = () => {
  cron.schedule("* * * * *", () => {
    cancelExpiredUnpaidOrders();
  });

  cron.schedule("*/15 * * * *", () => {
    enforceFulfillmentSLA();
  });

  console.log("🚀 [Background Workers] SLA & Expiry Cron Jobs Initialized.");
};
