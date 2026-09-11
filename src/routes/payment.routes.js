const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth.middleware");
const {
  initiateMoMoPayment,
  initiateKpayCardPayment,
  initiateKpayMomoPayment,
  handlePaymentWebhook,
} = require("../controllers/payment.controller");

// Initiate MoMo / Airtel Push Notification
router.post("/momo/initiate", protect, initiateMoMoPayment);

// K-Pay | Online Payment Gateway System Rwanda, card (Visa/Mastercard) & MoMo
router.post("/kpay/card/initiate", protect, initiateKpayCardPayment);
router.post("/kpay/momo/initiate", protect, initiateKpayMomoPayment);

// Generic gateway webhook callback (idempotency & reference verified)
router.post("/webhook", handlePaymentWebhook);

module.exports = router;
