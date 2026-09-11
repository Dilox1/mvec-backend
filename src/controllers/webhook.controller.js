const crypto = require("crypto");
const prisma = require("../lib/prisma");
const paymentService = require("../services/payment.service");

function verifyWebhookSignature(payload, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const hmac = crypto.createHmac("sha256", secret).update(JSON.stringify(payload)).digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// @desc    MTN MoMo Payment Webhook Receiver
// @route   POST /api/webhooks/momo
exports.handleMomoWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-momo-signature"];
    const isSandbox = process.env.NODE_ENV !== "production" || !process.env.MOMO_WEBHOOK_SECRET;

    if (!isSandbox && !verifyWebhookSignature(req.body, signature, process.env.MOMO_WEBHOOK_SECRET)) {
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    const { financialTransactionId, externalId, amount, status } = req.body;

    if (status !== "SUCCESSFUL") {
      if (financialTransactionId) {
        await paymentService.recordIgnoredWebhook({
          provider: "MTN_MOMO",
          externalTransactionId: financialTransactionId,
          amount: Number(amount),
          payload: req.body,
        });
      }
      return res.status(200).json({ message: "Transaction status not SUCCESSFUL. Ignored." });
    }

    const externalTransactionId = financialTransactionId || externalId;

    let orderId = null;
    if (externalTransactionId) {
      const payment = await prisma.payment.findFirst({
        where: {
          OR: [
            { transactionReference: externalId },
            { gatewayReference: financialTransactionId || externalId },
            { gatewayReference: externalId },
          ],
        },
      });
      if (payment) orderId = payment.parentOrderId;
    }

    if (!orderId) {
      return res.status(404).json({ message: "Unable to resolve order for webhook callback." });
    }

    const result = await paymentService.processPaymentWebhook({
      provider: "MTN_MOMO",
      externalTransactionId,
      orderId,
      amount: Number(amount),
      payload: req.body,
    });

    return res.status(200).json({ success: true, message: "MoMo webhook processed successfully.", result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Airtel Money Payment Webhook Receiver
// @route   POST /api/webhooks/airtel
exports.handleAirtelWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-airtel-signature"];
    const isSandbox = process.env.NODE_ENV !== "production" || !process.env.AIRTEL_WEBHOOK_SECRET;

    if (!isSandbox && !verifyWebhookSignature(req.body, signature, process.env.AIRTEL_WEBHOOK_SECRET)) {
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    const { transaction } = req.body;
    const externalTransactionId = transaction?.id;
    const reference = transaction?.reference;
    const amount = Number(transaction?.amount);
    const statusCode = transaction?.status_code;

    if (statusCode !== "TS" && statusCode !== "200") {
      return res.status(200).json({ message: "Airtel transaction not successful. Ignored." });
    }

    let orderId = null;
    if (reference) {
      const payment = await prisma.payment.findFirst({
        where: { OR: [{ transactionReference: reference }, { gatewayReference: reference }] },
      });
      if (payment) orderId = payment.parentOrderId;
    }
    if (!orderId) {
      return res.status(404).json({ message: "Unable to resolve order for webhook callback." });
    }

    const result = await paymentService.processPaymentWebhook({
      provider: "AIRTEL_MONEY",
      externalTransactionId,
      orderId,
      amount,
      payload: req.body,
    });

    return res.status(200).json({ success: true, message: "Airtel webhook processed successfully.", result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    K-Pay Payment Webhook Receiver (card + K-Pay mobile money)
// @route   POST /api/webhooks/kpay
exports.handleKpayWebhook = async (req, res) => {
  try {
    const kpayService = require("../services/kpay.service");
    const signature = req.headers["x-kpay-signature"];
    const rawBody = JSON.stringify(req.body);

    if (!kpayService.verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ message: "Invalid webhook signature" });
    }

    const { reference, amount, status } = req.body;

    if (status !== "SUCCESSFUL" && status !== "SUCCESS") {
      await paymentService.recordIgnoredWebhook({
        provider: "KPAY",
        externalTransactionId: reference,
        amount: Number(amount),
        payload: req.body,
      });
      return res.status(200).json({ message: "K-Pay transaction not successful. Ignored." });
    }

    const payment = await prisma.payment.findFirst({
      where: { OR: [{ transactionReference: reference }, { gatewayReference: reference }] },
    });
    if (!payment) {
      return res.status(404).json({ message: "Unable to resolve payment for K-Pay webhook callback." });
    }

    const result = await paymentService.processPaymentWebhook({
      provider: "KPAY",
      externalTransactionId: reference,
      orderId: payment.parentOrderId,
      amount: Number(amount),
      payload: req.body,
    });

    return res.status(200).json({ success: true, message: "K-Pay webhook processed successfully.", result });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
