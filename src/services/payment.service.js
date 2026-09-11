const prisma = require("../lib/prisma");
const financialService = require("./financial.service");
const pricingService = require("./pricing.service");
const { notify } = require("../utils/notify.util");
const socketService = require("./socket.service");

/**
 * Record a webhook callback that was intentionally ignored (e.g. non-successful
 * status). Persisting it under the external id keeps our idempotency semantics
 * clear and avoids it ever being confused with a successful transaction.
 */
exports.recordIgnoredWebhook = async ({ provider, externalTransactionId, amount = 0, payload = {} }) => {
  if (!externalTransactionId) return null;
  try {
    return await prisma.paymentWebhookLog.create({
      data: {
        provider,
        externalTransactionId,
        internalOrderId: null,
        status: "IGNORED",
        amount: Number(amount) || 0,
        currency: "RWF",
        rawPayload: payload,
        errorMessage: "Transaction status not SUCCESSFUL. Ignored.",
      },
    });
  } catch (err) {
    // Duplicate idempotency record, safe to swallow.
    return null;
  }
};

/**
 * Process payment callback idempotently
 */
exports.processPaymentWebhook = async ({ provider, externalTransactionId, orderId, amount, payload }) => {
  const existingLog = await prisma.paymentWebhookLog.findUnique({ where: { externalTransactionId } });
  if (existingLog && existingLog.status === "PROCESSED") {
    return { status: "ALREADY_PROCESSED", log: existingLog };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) {
        throw new Error(`Order #${orderId} not found.`);
      }

      if (order.paymentStatus === "PAID") {
        return { status: "ALREADY_PAID", order };
      }

      if (order.totalAmount !== amount) {
        throw new Error(`Mismatched payment amount. Expected: ${order.totalAmount}, Received: ${amount}`);
      }

      const deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: "PAID", orderStatus: "PROCESSING", deliveryOtp },
      });

      for (const item of order.items) {
        const snapshot = await pricingService.createItemPricingSnapshot({
          orderId: order.id,
          item: {
            productId: item.productId,
            vendorId: item.vendorId,
            categoryId: item.categoryId,
            price: item.price,
            quantity: item.quantity,
          },
          tx,
        });

        await financialService.lockPaymentInEscrow({
          orderId: order.id,
          vendorId: item.vendorId,
          grossAmount: snapshot.grossTotal,
          commissionAmount: snapshot.commissionAmount,
          tx,
        });
      }

      const webhookLog = await tx.paymentWebhookLog.upsert({
        where: { externalTransactionId },
        update: {
          provider,
          internalOrderId: order.id,
          status: "PROCESSED",
          amount,
          rawPayload: payload,
        },
        create: {
          provider,
          externalTransactionId,
          internalOrderId: order.id,
          status: "PROCESSED",
          amount,
          rawPayload: payload,
        },
      });

      return { status: "SUCCESS", order: updatedOrder, webhookLog };
    });

    if (result.status === "SUCCESS" && result.order) {
      socketService.emitToRoom(`user:${result.order.userId}`, "payment_confirmed", {
        orderId: result.order.id,
        orderNumber: result.order.orderNumber,
      });

      await notify({
        userId: result.order.userId,
        type: "PAYMENT",
        title: "Payment successful",
        body: `Your payment for order #${result.order.orderNumber} was confirmed. Your order is now being processed.`,
        link: `/orders/${result.order.id}`,
      }).catch(() => null);
    }

    return result;
  } catch (error) {
    await prisma.paymentWebhookLog
      .upsert({
        where: { externalTransactionId },
        update: {
          provider,
          internalOrderId: orderId,
          status: "FAILED",
          amount,
          rawPayload: payload,
          errorMessage: error.message,
        },
        create: {
          provider,
          externalTransactionId,
          internalOrderId: orderId,
          status: "FAILED",
          amount,
          rawPayload: payload,
          errorMessage: error.message,
        },
      })
      .catch(() => null);

    throw error;
  }
};
