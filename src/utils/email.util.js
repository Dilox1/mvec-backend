// src/utils/email.util.js
// Shared email sending utility. Supports two providers, selected via
// EMAIL_PROVIDER:
//   - EMAIL_PROVIDER=sendgrid (recommended for production) -> SendGrid Web
//     API using @sendgrid/mail and SENDGRID_API_KEY.
//   - EMAIL_PROVIDER unset or "smtp" (default) -> Nodemailer, Gmail
//     app-password by default, or any SMTP host via EMAIL_HOST/EMAIL_PORT.
// Used by auth (password reset), orders, disputes, and support notifications.
const nodemailer = require("nodemailer");

let cachedTransporter = null;
let sendgridConfigured = false;

function isSendGrid() {
  return (process.env.EMAIL_PROVIDER || "").toLowerCase() === "sendgrid";
}

function getSendGridClient() {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SendGrid is selected (EMAIL_PROVIDER=sendgrid) but SENDGRID_API_KEY is not configured.",
    );
  }
  const sgMail = require("@sendgrid/mail");
  if (!sendgridConfigured) {
    sgMail.setApiKey(apiKey);
    sendgridConfigured = true;
  }
  return sgMail;
}

function getTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error(
      "Email credentials are not configured. Please set EMAIL_USER and EMAIL_PASS environment variables.",
    );
  }

  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = process.env.EMAIL_HOST
    ? nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT) || 587,
        secure: process.env.EMAIL_SECURE === "true" || process.env.EMAIL_PORT === "465",
        auth: { user, pass },
      })
    : nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || "Gmail",
        auth: { user, pass },
      });

  return cachedTransporter;
}

/**
 * Sends a plain/HTML email through whichever provider EMAIL_PROVIDER
 * selects. Never throws to the caller by default, set `throwOnError: true`
 * when the caller needs to react to a failed send (e.g. password reset,
 * where the token must be rolled back on failure).
 */
async function sendEmail({ to, subject, text, html, throwOnError = false }) {
  try {
    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.SENDGRID_FROM_EMAIL;

    if (isSendGrid()) {
      const sgMail = getSendGridClient();
      await sgMail.send({
        to,
        from: { email: fromAddress, name: "MVEC" },
        subject,
        text,
        html,
      });
      return { sent: true, provider: "sendgrid" };
    }

    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"MVEC" <${fromAddress}>`,
      to,
      subject,
      text,
      html,
    });
    return { sent: true, provider: "smtp" };
  } catch (error) {
    const message = error.response?.body?.errors?.[0]?.message || error.message;
    console.error("Email send error:", message);
    if (throwOnError) throw new Error(message);
    return { sent: false, error: message };
  }
}

module.exports = { getTransporter, sendEmail };
