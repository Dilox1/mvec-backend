const prisma = require("../lib/prisma");
const financialService = require("../services/financial.service");
const { notify, notifyMany } = require("../utils/notify.util");

const generateOrderNumber = () => `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

// @desc    Checkout user cart & create order
// @route   POST /api/orders/checkout
exports.createCheckoutOrder = async (req, res) => {
  try {
    const { shippingAddress, paymentMethod = "CARD" } = req.body;

    if (!shippingAddress || !shippingAddress.street || !shippingAddress.city) {
      return res.status(400).json({ message: "Complete shipping address is required." });
    }

    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: { items: { include: { product: true } } },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ message: "Your cart is empty." });
    }

    const orderItems = [];
    let calculatedTotal = 0;

    for (const item of cart.items) {
      const product = item.product;

      if (!product || product.status === "INACTIVE") {
        return res.status(400).json({ message: `Product ${product?.name || ""} is no longer available.` });
      }

      if (product.stockQuantity < item.quantity) {
        return res.status(400).json({
          message: `Insufficient stock for ${product.name}. Available: ${product.stockQuantity}`,
        });
      }

      const activePrice = product.discountPrice || product.price;
      calculatedTotal += activePrice * item.quantity;

      orderItems.push({
        productId: product.id,
        vendorId: product.vendorId,
        categoryId: product.categoryId,
        name: product.name,
        price: activePrice,
        quantity: item.quantity,
      });
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: req.user.id,
          orderNumber: generateOrderNumber(),
          shippingStreet: shippingAddress.street,
          shippingCity: shippingAddress.city,
          shippingState: shippingAddress.state || "",
          shippingCountry: shippingAddress.country || "Rwanda",
          shippingPostalCode: shippingAddress.postalCode,
          totalAmount: calculatedTotal,
          paymentMethod,
          items: { create: orderItems },
        },
        include: { items: true },
      });

      for (const item of cart.items) {
        const newQty = item.product.stockQuantity - item.quantity;
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: Math.max(newQty, 0),
            status: newQty <= 0 ? "OUT_OF_STOCK" : item.product.status,
          },
        });
      }

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { totalAmount: 0 } });

      return created;
    });

    await notifyVendorsOfNewOrder(order).catch(() => null);

    return res.status(201).json({ message: "Order placed successfully", order });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Notify every vendor represented in an order that a new order has arrived.
 */
async function notifyVendorsOfNewOrder(order) {
  const vendorIds = [...new Set((order.items || []).map((i) => i.vendorId).filter(Boolean))];
  await notifyMany(vendorIds, {
    type: "ORDER",
    title: "New order received",
    body: `Order #${order.orderNumber} includes one of your products. Prepare it for dispatch.`,
    link: `/vendor/orders`,
  });
}

// @desc    Direct checkout, accepts items in request body (for frontend-driven orders)
// @route   POST /api/orders/direct-checkout
exports.directCheckout = async (req, res) => {
  try {
    const { items, shippingAddress, paymentMethod = "MOMO" } = req.body;

    if (!shippingAddress || !shippingAddress.street || !shippingAddress.city) {
      return res.status(400).json({ message: "Complete shipping address is required." });
    }

    if (!items || !items.length) {
      return res.status(400).json({ message: "At least one item is required." });
    }

    const orderItems = [];
    let calculatedTotal = 0;

    const order = await prisma.$transaction(async (tx) => {
      for (const item of items) {
        let resolvedVendorId = item.vendor || null;
        let resolvedName = item.name;
        let resolvedPrice = item.price;
        let resolvedProductId = null;
        let resolvedCategoryId = null;

        if (item.productId) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (product && product.status !== "INACTIVE") {
            resolvedProductId = product.id;
            resolvedVendorId = product.vendorId;
            resolvedCategoryId = product.categoryId;
            resolvedName = product.name;
            resolvedPrice = product.discountPrice || product.price;

            if (product.stockQuantity < item.qty) {
              throw Object.assign(
                new Error(`Insufficient stock for ${product.name}. Available: ${product.stockQuantity}`),
                { statusCode: 400 },
              );
            }

            const newQty = product.stockQuantity - item.qty;
            await tx.product.update({
              where: { id: product.id },
              data: { stockQuantity: Math.max(newQty, 0), status: newQty <= 0 ? "OUT_OF_STOCK" : product.status },
            });
          }
        }

        calculatedTotal += resolvedPrice * item.qty;

        orderItems.push({
          productId: resolvedProductId,
          vendorId: resolvedVendorId,
          categoryId: resolvedCategoryId,
          name: resolvedName,
          price: resolvedPrice,
          quantity: item.qty,
        });
      }

      return tx.order.create({
        data: {
          userId: req.user.id,
          orderNumber: generateOrderNumber(),
          shippingStreet: shippingAddress.street,
          shippingCity: shippingAddress.city,
          shippingState: shippingAddress.state || "",
          shippingCountry: shippingAddress.country || "Rwanda",
          shippingPostalCode: shippingAddress.postalCode,
          totalAmount: calculatedTotal,
          paymentMethod,
          items: { create: orderItems },
        },
        include: { items: true },
      });
    });

    await notifyVendorsOfNewOrder(order).catch(() => null);

    return res.status(201).json({ message: "Order placed successfully", order });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

// @desc    Get logged-in user's orders
// @route   GET /api/orders/my-orders
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ orders });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get single order details
// @route   GET /api/orders/:id
exports.getOrderById = async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { fullName: true, email: true } },
        items: { include: { vendor: { select: { fullName: true, companyName: true, email: true } } } },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isBuyer = order.userId === req.user.id;
    const isVendor = order.items.some((item) => item.vendorId === req.user.id);
    const isAdmin = req.user.role === "super_admin";

    if (!isBuyer && !isVendor && !isAdmin) {
      return res.status(403).json({ message: "Access denied." });
    }

    return res.status(200).json({ order });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get orders containing vendor's products
// @route   GET /api/orders/vendor/orders
exports.getVendorOrders = async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { items: { some: { vendorId: req.user.id } } },
      include: { user: { select: { fullName: true, email: true } }, items: true },
      orderBy: { createdAt: "desc" },
    });

    const filteredOrders = orders.map((order) => {
      const vendorItems = order.items.filter((item) => item.vendorId === req.user.id);
      return {
        _id: order.id,
        orderNumber: order.orderNumber,
        user: order.user,
        shippingAddress: {
          street: order.shippingStreet,
          city: order.shippingCity,
          state: order.shippingState,
          country: order.shippingCountry,
        },
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        createdAt: order.createdAt,
        items: vendorItems,
        vendorSubtotal: vendorItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
      };
    });

    return res.status(200).json({ orders: filteredOrders });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update vendor-specific order status
// @route   PATCH /api/orders/vendor/:id/status
exports.updateVendorOrderStatus = async (req, res) => {
  try {
    const { orderId, status, paymentStatus } = req.body;
    const allowedOrderStatuses = [
      "PENDING", "CONFIRMED", "PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED",
      "DELIVERED", "CANCELLED", "RETURNED", "REFUNDED", "FAILED",
    ];
    const allowedPaymentStatuses = ["PENDING", "CONFIRMED", "PAID", "FAILED", "REFUNDED"];

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const hasVendorItems = order.items.some((item) => item.vendorId === req.user.id);
    if (!hasVendorItems && req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access denied: You do not own items in this order." });
    }

    const data = {};
    if (status) {
      if (!allowedOrderStatuses.includes(status)) {
        return res.status(400).json({ message: `Invalid order status: ${status}` });
      }
      data.orderStatus = status;
    }
    if (paymentStatus) {
      if (!allowedPaymentStatuses.includes(paymentStatus)) {
        return res.status(400).json({ message: `Invalid payment status: ${paymentStatus}` });
      }
      data.paymentStatus = paymentStatus;
    }

    const updated = await prisma.order.update({ where: { id: orderId }, data });

    if (status === "DELIVERED") {
      await releaseVendorEscrowFunds(orderId, req.user.id);
    }

    return res.status(200).json({ message: "Order updated successfully", order: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update Order Status (e.g., PENDING -> PROCESSING -> SHIPPED -> DELIVERED)
// @route   PATCH /api/orders/:id/status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
    if (!status || !validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({ message: "Invalid order status provided." });
    }

    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    const updatedStatus = status.toUpperCase();

    if (order.orderStatus === "DELIVERED") {
      return res.status(400).json({ message: "Order has already been marked as DELIVERED." });
    }

    const data = { orderStatus: updatedStatus };
    if (updatedStatus === "DELIVERED") {
      data.deliveredAt = new Date();
      data.isDelivered = true;
    }

    const updated = await prisma.order.update({ where: { id }, data });

    // 🚀 EARNINGS RELEASE ENGINE: release pending earnings per vendor once DELIVERED
    if (updatedStatus === "DELIVERED") {
      const vendorIds = [...new Set(order.items.map((item) => item.vendorId).filter(Boolean))];
      for (const vendorId of vendorIds) {
        await releaseVendorEscrowFunds(order.id, vendorId);
      }
      await notify({
        userId: order.userId,
        type: "DELIVERY",
        title: "Order delivered",
        body: `Your order #${order.orderNumber} has been marked as delivered. Thank you for shopping on MVEC!`,
        link: `/orders/${order.id}`,
      }).catch(() => null);
    }

    return res.status(200).json({ message: `Order status successfully updated to ${updatedStatus}.`, order: updated });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Confirm Order Delivery & Release Escrow Funds
// @route   PATCH /api/orders/:id/deliver
exports.confirmOrderDelivery = async (req, res) => {
  try {
    const { id } = req.params;
    const { deliveryOtp } = req.body;

    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (order.orderStatus === "DELIVERED") {
      return res.status(400).json({ message: "Order is already marked as DELIVERED." });
    }

    if (!deliveryOtp || !order.deliveryOtp || order.deliveryOtp !== deliveryOtp) {
      return res.status(400).json({ message: "Invalid delivery verification code." });
    }

    if (req.user.role === "vendor" && !order.items.some((item) => item.vendorId === req.user.id)) {
      return res.status(403).json({ message: "This order does not contain any of your products." });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { orderStatus: "DELIVERED", isDelivered: true, deliveredAt: new Date() },
    });

    const vendorIds = [...new Set(order.items.map((item) => item.vendorId).filter(Boolean))];
    for (const vendorId of vendorIds) {
      await releaseVendorEscrowFunds(order.id, vendorId);
    }

    await notify({
      userId: order.userId,
      type: "DELIVERY",
      title: "Order delivered",
      body: `Your order #${order.orderNumber} has been delivered and confirmed.`,
      link: `/orders/${order.id}`,
    }).catch(() => null);

    return res.status(200).json({
      message: "Order delivered successfully and funds released from escrow.",
      order: updated,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

/**
 * Internal Escrow Release Helper, finds the HELD settlement for this
 * order/vendor pair and releases it atomically through financial.service.
 */
async function releaseVendorEscrowFunds(orderId, vendorId) {
  const settlement = await prisma.settlement.findFirst({
    where: { orderId, vendorId, status: "HELD" },
  });
  if (!settlement) return; // Already released or non-existent

  await prisma.$transaction(async (tx) => {
    await financialService.releaseEscrowToVendor({ settlementId: settlement.id, tx });
  });
}

exports.releaseVendorEscrowFunds = releaseVendorEscrowFunds;

// @desc    List orders that are paid and awaiting delivery confirmation.
//          Delivery partners and admins see every such order; a vendor only
//          sees orders that contain their own products.
// @route   GET /api/orders/deliverable
exports.getDeliverableOrders = async (req, res) => {
  try {
    const where = {
      paymentStatus: "PAID",
      orderStatus: { in: ["PROCESSING", "READY_FOR_SHIPMENT", "SHIPPED"] },
    };
    if (req.user.role === "vendor") {
      where.items = { some: { vendorId: req.user.id } };
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        user: { select: { fullName: true, phone: true } },
        items: { include: { vendor: { select: { fullName: true, companyName: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    return res.status(200).json({ orders });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Buyer cancels their own order (within the allowed window)
// @route   PATCH /api/orders/:id/cancel
exports.cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const CANCEL_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

    const order = await prisma.order.findUnique({ where: { id }, include: { items: true } });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }
    if (order.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only cancel your own orders." });
    }
    if (!["PENDING", "CONFIRMED", "PROCESSING"].includes(order.orderStatus)) {
      return res.status(400).json({ message: `Order can no longer be cancelled (status: ${order.orderStatus}).` });
    }

    if (order.paymentStatus === "PAID") {
      const elapsed = Date.now() - new Date(order.createdAt).getTime();
      if (elapsed > CANCEL_WINDOW_MS) {
        return res.status(400).json({ message: "The 30-minute cancellation window for a paid order has passed." });
      }
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Restore stock for every item that had a real product.
      for (const item of order.items) {
        if (!item.productId) continue;
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQuantity: { increment: item.quantity } },
        });
      }

      // If the order had already been paid, reverse the escrow hold: cancel
      // any still-HELD settlement and pull the corresponding amount back out
      // of the vendor's pending balance.
      if (order.paymentStatus === "PAID") {
        const settlements = await tx.settlement.findMany({ where: { orderId: id, status: "HELD" } });
        for (const settlement of settlements) {
          await tx.settlement.update({ where: { id: settlement.id }, data: { status: "CANCELLED" } });
          await tx.vendorWallet.updateMany({
            where: { vendorId: settlement.vendorId },
            data: { pendingBalance: { decrement: settlement.netAmount } },
          });
        }
      }

      return tx.order.update({
        where: { id },
        data: {
          orderStatus: "CANCELLED",
          paymentStatus: order.paymentStatus === "PAID" ? "REFUNDED" : order.paymentStatus,
          cancellationReason: "Cancelled by buyer",
        },
      });
    });

    return res.status(200).json({
      message:
        order.paymentStatus === "PAID"
          ? "Order cancelled and a full refund has been recorded."
          : "Order cancelled successfully.",
      order: updatedOrder,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Admin: list ALL orders across the marketplace, paginated + filterable
// @route   GET /api/admin/orders?status=&paymentStatus=&q=&page=&pageSize=
exports.adminGetOrders = async (req, res) => {
  try {
    const { status, paymentStatus, q, page = 1, pageSize = 20 } = req.query;

    const where = {};
    if (status) where.orderStatus = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (q) {
      where.OR = [
        { orderNumber: { contains: q } },
        { user: { fullName: { contains: q } } },
      ];
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(parseInt(pageSize, 10) || 20, 100);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: { select: { fullName: true, email: true } },
          items: { include: { vendor: { select: { fullName: true, companyName: true } } } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return res.status(200).json({ data: orders, meta: { page: pageNum, pageSize: limit, total } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
