// src/services/kpay.service.js
// K-Pay (Rwanda) online payment gateway abstraction, supports both
// Mobile Money collection and Visa/Mastercard card charges through a
// single hosted-checkout style API.
//
// Docs reference: K-Pay | Online Payment Gateway System Rwanda
//
// Configure in production:
//   KPAY_BASE_URL, KPAY_MERCHANT_ID, KPAY_API_KEY, KPAY_CALLBACK_SECRET
//
// When KPAY_BASE_URL is not set (or NODE_ENV !== "production"), the service
// runs in sandbox mode: a fake checkout session/reference is generated so the
// full checkout → payment → escrow flow can be exercised end-to-end locally.

const crypto = require("crypto");

function isSandbox() {
  return process.env.NODE_ENV !== "production" || !process.env.KPAY_BASE_URL;
}

function generateReference(prefix = "KPAY") {
  return `${prefix}${Date.now()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Create a hosted checkout session for a card payment.
 * @returns {Promise<{reference:string, redirectUrl:string|null, raw:object}>}
 */
async function createCardCheckout({ amount, currency = "RWF", orderId, customer }) {
  const reference = generateReference("KPAYCARD");

  if (isSandbox()) {
    return {
      reference,
      redirectUrl: null,
      status: "PENDING",
      raw: { sandbox: true, message: "Card checkout session simulated in sandbox mode" },
    };
  }

  const res = await fetch(`${process.env.KPAY_BASE_URL}/checkout/card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.KPAY_API_KEY}`,
      "X-Merchant-Id": process.env.KPAY_MERCHANT_ID || "",
    },
    body: JSON.stringify({
      amount: String(amount),
      currency,
      reference,
      order_id: orderId,
      customer,
      callback_url: process.env.KPAY_WEBHOOK_URL,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`K-Pay card checkout failed with status ${res.status}: ${text}`);
  }

  const data = await res.json().catch(() => ({}));
  return { reference, redirectUrl: data.redirect_url || data.checkoutUrl || null, status: "PENDING", raw: data };
}

/**
 * Trigger a K-Pay mobile money collection (USSD push).
 */
async function createMomoCollection({ amount, currency = "RWF", phone, orderId }) {
  const reference = generateReference("KPAYMOMO");

  if (isSandbox()) {
    return {
      reference,
      status: "PENDING",
      raw: { sandbox: true, message: "K-Pay MoMo collection simulated in sandbox mode" },
    };
  }

  const res = await fetch(`${process.env.KPAY_BASE_URL}/collection/momo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.KPAY_API_KEY}`,
      "X-Merchant-Id": process.env.KPAY_MERCHANT_ID || "",
    },
    body: JSON.stringify({
      amount: String(amount),
      currency,
      msisdn: phone,
      reference,
      order_id: orderId,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`K-Pay MoMo collection failed with status ${res.status}: ${text}`);
  }

  return { reference, status: "PENDING", raw: await res.json().catch(() => ({})) };
}

/**
 * Verify the HMAC signature K-Pay attaches to webhook callbacks.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.KPAY_CALLBACK_SECRET;
  if (!secret || !signatureHeader) return isSandbox(); // sandbox: accept unsigned callbacks
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  isSandbox,
  generateReference,
  createCardCheckout,
  createMomoCollection,
  verifyWebhookSignature,
};
