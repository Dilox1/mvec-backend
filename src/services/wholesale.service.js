const prisma = require("../lib/prisma");

class WholesaleService {
  /**
   * Validate MOQ and create B2B Wholesale Order
   */
  async createWholesaleOrder({ vendorId, supplierId, items }) {
    let totalAmount = 0;

    for (const item of items) {
      if (item.quantity < item.moq) {
        throw new Error(
          `MOQ Breach: Item '${item.productName}' requires a minimum quantity of ${item.moq}, but got ${item.quantity}.`,
        );
      }
      totalAmount += item.unitPrice * item.quantity;
    }

    const orderNumber = `WSO-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();

    return prisma.wholesaleOrder.create({
      data: {
        orderNumber,
        vendorId,
        supplierId,
        totalAmount,
        status: "PENDING_PAYMENT",
        deliveryOtp,
        items: {
          create: items.map((item) => ({
            productId: item.productId || null,
            productName: item.productName,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            moq: item.moq,
          })),
        },
      },
      include: { items: true },
    });
  }

  /**
   * Hold Vendor Funds in Escrow upon successful B2B Payment
   */
  async holdWholesaleEscrow(orderId) {
    const order = await prisma.wholesaleOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Wholesale order not found.");
    if (order.status !== "PENDING_PAYMENT") {
      throw new Error(`Invalid order status transition from ${order.status}`);
    }

    return prisma.wholesaleOrder.update({ where: { id: orderId }, data: { status: "ESCROW_HELD" } });
  }

  /**
   * Confirm Physical Receipt and Release Escrow Funds to Supplier
   */
  async confirmReceiptAndRelease(orderId, providedOtp = null) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.wholesaleOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new Error("Wholesale order not found.");

      if (!["ESCROW_HELD", "SHIPPED", "DELIVERED"].includes(order.status)) {
        throw new Error(`Cannot release escrow for order in status: ${order.status}`);
      }

      if (providedOtp && order.deliveryOtp !== providedOtp) {
        throw new Error("Invalid delivery confirmation OTP.");
      }

      const supplierWallet = await tx.vendorWallet.upsert({
        where: { vendorId: order.supplierId },
        update: {
          availableBalance: { increment: order.totalAmount },
          totalEarned: { increment: order.totalAmount },
        },
        create: {
          vendorId: order.supplierId,
          availableBalance: order.totalAmount,
          totalEarned: order.totalAmount,
        },
      });

      const updatedOrder = await tx.wholesaleOrder.update({
        where: { id: orderId },
        data: { status: "CONFIRMED_RELEASED", confirmedAt: new Date() },
      });

      return { order: updatedOrder, newSupplierBalance: supplierWallet.availableBalance };
    });
  }
}

module.exports = new WholesaleService();
