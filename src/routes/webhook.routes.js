const express = require("express");
const router = express.Router();
const { handleMomoWebhook, handleAirtelWebhook, handleKpayWebhook } = require("../controllers/webhook.controller");

// MTN MoMo payment callback (public, provider-verified)
router.post("/momo", handleMomoWebhook);

// Airtel Money payment callback (public, provider-verified)
router.post("/airtel", handleAirtelWebhook);

// K-Pay payment callback (card + K-Pay MoMo, public, provider-verified)
router.post("/kpay", handleKpayWebhook);

module.exports = router;
