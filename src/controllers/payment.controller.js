const prisma = require("../lib/prisma");
const { formatRwandanPhone } = require("../utils/momo.util");
const pricingService = require("../services/pricing.service");
const financialService = require("../services/financial.service");
const momoService = require("../services/momo.service");
const kpayService = require("../services/kpay.service");

// 1. Initiate MoMo / Airtel USSD Push Payment
exports.initiateMoMoPayment = async (req, res) => {
  try {
    const { orderId, phoneNumber } = req.body;

    const phoneInfo = formatRwandanPhone(phoneNumber);
    if (!phoneInfo) {
      return res.status(400).json({
        message: "Invalid Rwandan phone number. Must start with 078/079 (MTN) or 073/072 (Airtel).",
      });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (order.paymentStatus === "PAID") {
      return res.status(400).json({ message: "Order is already paid." });
    }

    const paymentMethod = phoneInfo.provider === "MTN" ? "MOMO" : "AIRTEL";
    const transactionRef = `ORD-${order.id}-${Date.now()}`;

    let payment = await prisma.payment.create({
      data: {
        parentOrderId: order.id,
        transactionReference: transactionRef,
        method: paymentMethod,
        phoneNumber: phoneInfo.formattedNumber,
        provider: phoneInfo.provider,
        amount: order.totalAmount,
        currency: "RWF",
        status: "PENDING",
        gatewayResponse: { phase: "initiated" },
      },
    });

    await prisma.order.update({ where: { id: order.id }, data: { paymentMethod } });

    let gatewayReference = null;
    try {
      const push = await momoService.triggerUssdPush({
        amount: order.totalAmount,
        currency: "RWF",
        phone: phoneInfo.formattedNumber,
      });
      gatewayReference = push.reference || null;
      payment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          gatewayResponse: push.raw || payment.gatewayResponse,
          gatewayReference: gatewayReference || undefined,
        },
      });
    } catch (pushError) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { gatewayResponse: { error: pushError.message }, status: "FAILED" },
      });
      return res.status(502).json({
        message: "Unable to reach the mobile money gateway. Payment not pushed.",
        error: pushError.message,
      });
    }

    return res.status(200).json({
      message: `Payment prompt initiated for ${paymentMethod} (${phoneInfo.localNumber}). Please approve the USSD prompt on your phone.`,
      paymentRef: transactionRef,
      paymentId: payment.id,
      amount: order.totalAmount,
      gatewayReference,
    });
  } catch (error) {
    return res.status(500).json({ message: "Payment initiation failed", error: error.message });
  }
};

// 2. Initiate a K-Pay card checkout (Visa / Mastercard via K-Pay Rwanda)
// @route   POST /api/payments/kpay/card/initiate
exports.initiateKpayCardPayment = async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { user: true } });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }
    if (order.paymentStatus === "PAID") {
      return res.status(400).json({ message: "Order is already paid." });
    }

    const checkout = await kpayService.createCardCheckout({
      amount: order.totalAmount,
      currency: "RWF",
      orderId: order.id,
      customer: { name: req.user.fullName, email: req.user.email, phone: req.user.phone },
    });

    const payment = await prisma.payment.create({
      data: {
        parentOrderId: order.id,
        transactionReference: checkout.reference,
        method: "CARD",
        provider: "KPAY_CARD",
        amount: order.totalAmount,
        currency: "RWF",
        status: "PENDING",
        gatewayResponse: checkout.raw,
      },
    });

    await prisma.order.update({ where: { id: order.id }, data: { paymentMethod: "CARD" } });

    return res.status(200).json({
      message: "Card checkout session created. Redirect the buyer to complete payment.",
      paymentId: payment.id,
      paymentRef: checkout.reference,
      redirectUrl: checkout.redirectUrl,
    });
  } catch (error) {
    return res.status(500).json({ message: "K-Pay card checkout failed", error: error.message });
  }
};

// 3. Initiate a K-Pay Mobile Money collection (alternative MoMo rail via K-Pay)
// @route   POST /api/payments/kpay/momo/initiate
exports.initiateKpayMomoPayment = async (req, res) => {
  try {
    const { orderId, phoneNumber } = req.body;

    const phoneInfo = formatRwandanPhone(phoneNumber);
    if (!phoneInfo) {
      return res.status(400).json({ message: "Invalid Rwandan phone number." });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }
    if (order.paymentStatus === "PAID") {
      return res.status(400).json({ message: "Order is already paid." });
    }

    const collection = await kpayService.createMomoCollection({
      amount: order.totalAmount,
      currency: "RWF",
      phone: phoneInfo.formattedNumber,
      orderId: order.id,
    });

    const payment = await prisma.payment.create({
      data: {
        parentOrderId: order.id,
        transactionReference: collection.reference,
        method: "MOMO",
        phoneNumber: phoneInfo.formattedNumber,
        provider: "KPAY_MOMO",
        amount: order.totalAmount,
        currency: "RWF",
        status: "PENDING",
        gatewayResponse: collection.raw,
      },
    });

    await prisma.order.update({ where: { id: order.id }, data: { paymentMethod: "MOMO" } });

    return res.status(200).json({
      message: `Payment prompt sent via K-Pay to ${phoneInfo.localNumber}. Please approve on your phone.`,
      paymentId: payment.id,
      paymentRef: collection.reference,
    });
  } catch (error) {
    return res.status(500).json({ message: "K-Pay MoMo collection failed", error: error.message });
  }
};

// 4. Idempotent Webhook Handler with Escrow & Dynamic Commissioning
// (generic gateway webhook shape, Paystack/K-Pay style { event, data: { reference, amount } })
exports.handlePaymentWebhook = async (req, res) => {
  try {
    const event = req.body;

    const reference = event.data?.reference || event.reference;
    const amount = event.data?.amount || event.amount;
    const isSuccessful = event.event === "charge.success" || event.status === "SUCCESSFUL";

    if (!isSuccessful) {
      return res.status(200).json({ status: "ignored", message: "Transaction not successful" });
    }

    const existingLog = await prisma.paymentWebhookLog.findUnique({ where: { externalTransactionId: reference } });
    if (existingLog && existingLog.status === "PROCESSED") {
      return res.status(200).json({ status: "success", message: "Already processed" });
    }

    const payment = await prisma.payment.findUnique({ where: { transactionReference: reference } });
    if (!payment) {
      return res.status(404).json({ message: "Associated payment record not found." });
    }

    const provider = payment.provider === "MTN" ? "MTN_MOMO" : payment.provider === "AIRTEL" ? "AIRTEL_MONEY" : "KPAY";

    const result = await require("../services/payment.service").processPaymentWebhook({
      provider,
      externalTransactionId: reference,
      orderId: payment.parentOrderId,
      amount: Number(amount),
      payload: event,
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCESS", paidAt: new Date(), gatewayResponse: event },
    });

    return res.status(200).json({ status: "success", message: "Payment processed & escrow locked.", result });
  } catch (error) {
    return res.status(500).json({ message: "Webhook processing error", error: error.message });
  }
};
