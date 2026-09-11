// src/utils/sms.util.js
const { formatRwandanPhone } = require("./momo.util");

/**
 * Normalizes a Rwandan phone number to a canonical international format.
 * Accepts "0788123456", "+250788123456" or "250788123456".
 * Returns "+250788123456" or null when invalid.
 */
exports.normalizePhone = (phone) => {
  if (!phone) return null;
  const parsed = formatRwandanPhone(phone);
  if (!parsed) return null;
  return `+${parsed.formattedNumber}`;
};

/**
 * Returns all plausible stored representations for a phone number so lookups
 * match records saved by legacy flows (local "0788..." format) as well as new
 * OTP-created users (international "+250..." format).
 * @returns {string[]} e.g. ["+250788123456", "250788123456", "0788123456"]
 */
exports.phoneVariants = (phone) => {
  const normalized = exports.normalizePhone(phone);
  if (!normalized) return [];
  const digits = normalized.replace("+", "");
  const local = `0${digits.slice(3)}`;
  return [normalized, digits, local];
};

/**
 * Generates a cryptographically-secure numeric OTP code.
 * @param {number} length - number of digits (default 6)
 */
exports.generateOtpCode = (length = 6) => {
  const crypto = require("crypto");
  const max = Math.pow(10, length);
  const min = Math.pow(10, length - 1);
  const random = crypto.randomInt(min, max);
  return random.toString();
};

/**
 * Sends a plain SMS message through the configured gateway. Supports:
 *   - SMS_PROVIDER=log        → prints to server console (default/dev)
 *   - SMS_PROVIDER=generic    → any HTTP SMS gateway (e.g. many Rwandan
 *                               aggregators, Africa's Talking-style APIs)
 *                               configured via SMS_GATEWAY_URL /
 *                               SMS_GATEWAY_API_KEY / SMS_GATEWAY_SENDER_ID
 *
 * @param {string} phone   - canonical international number (e.g. "+250788123456")
 * @param {string} message - the SMS body
 * @returns {Promise<{success:boolean, provider:string, raw?:object}>}
 */
async function sendSms(phone, message) {
  const provider = (process.env.SMS_PROVIDER || "log").toLowerCase();

  if (provider === "log" || !provider) {
    console.log(`[SMS] -> ${phone}: ${message}`);
    return { success: true, provider: "log" };
  }

  if (provider === "generic") {
    const url = process.env.SMS_GATEWAY_URL;
    if (!url) {
      console.log(`[SMS] SMS_GATEWAY_URL not configured; falling back to log for ${phone}: ${message}`);
      return { success: true, provider: "log-fallback" };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SMS_GATEWAY_API_KEY
          ? { Authorization: `Bearer ${process.env.SMS_GATEWAY_API_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        to: phone,
        message,
        sender_id: process.env.SMS_GATEWAY_SENDER_ID || process.env.SMS_FROM_NAME || "MVEC",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SMS gateway request failed (${res.status}): ${text}`);
    }

    return { success: true, provider: "generic", raw: await res.json().catch(() => ({})) };
  }

  console.log(`[SMS] provider "${provider}" not implemented; message for ${phone}: ${message}`);
  return { success: false, provider };
}
exports.sendSms = sendSms;

/**
 * Sends an OTP code to a phone number via the configured SMS gateway.
 *
 * @param {string} phone  - canonical international number (e.g. "+250788123456")
 * @param {string} code   - the OTP code to deliver
 * @param {object} [opts] - optional metadata
 * @returns {Promise<void>}
 */
exports.sendOtpSms = async (phone, code, opts = {}) => {
  const smsFrom = process.env.SMS_FROM_NAME || "MVEC";
  const message = `${smsFrom}: your verification code is ${code}. It expires in ${Math.round(
    Number(process.env.OTP_EXPIRY_SECONDS || 300) / 60,
  )} minutes.`;
  await sendSms(phone, message);
};
