const wholesaleService = require("../services/wholesale.service");
const prisma = require("../lib/prisma");

// @desc    List my wholesale orders: a vendor sees orders they placed, a
//          supplier sees orders placed with them
// @route   GET /api/wholesale/orders/mine
exports.getMyWholesaleOrders = async (req, res) => {
  try {
    const where = req.user.role === "supplier" ? { supplierId: req.user.id } : { vendorId: req.user.id };

    const orders = await prisma.wholesaleOrder.findMany({
      where,
      include: {
        items: true,
        vendor: { select: { fullName: true, companyName: true } },
        supplier: { select: { fullName: true, companyName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createWholesaleOrder = async (req, res) => {
  try {
    const { supplierId, items } = req.body;
    const vendorId = req.user.id; // Extracted from Auth JWT

    const order = await wholesaleService.createWholesaleOrder({
      vendorId,
      supplierId,
      items,
    });

    return res.status(201).json({
      success: true,
      message: "Wholesale supply order created successfully.",
      data: order,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.holdEscrow = async (req, res) => {
  try {
    const { orderId } = req.params;
    const updatedOrder = await wholesaleService.holdWholesaleEscrow(orderId);

    return res.status(200).json({
      success: true,
      message: "Funds locked in escrow successfully.",
      data: updatedOrder,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.confirmReceipt = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { otp } = req.body;

    const result = await wholesaleService.confirmReceiptAndRelease(orderId, otp);

    return res.status(200).json({
      success: true,
      message: "Wholesale order confirmed and escrow funds released to supplier.",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};