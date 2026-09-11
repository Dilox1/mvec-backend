// src/utils/notify.util.js
// Small helper for writing real, persisted notifications (Notification model)
// from anywhere in the backend, and emailing the same alert to the user
// (via SendGrid or SMTP, whichever EMAIL_PROVIDER selects) so nothing that
// matters is trapped inside the app if the person isn't looking at it right
// now. Never throws, a failed notification or email should never break the
// calling flow (an order/payment/dispute must still succeed either way).
const prisma = require("../lib/prisma");
const { sendEmail } = require("./email.util");

function renderEmail(title, body, link) {
  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
  const url = link ? `${frontendUrl}${link.startsWith("/") ? link : `/${link}`}` : null;

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin:0;background:#f4f8f9;font-family:Arial,sans-serif;">
      <div style="max-width:520px;margin:0 auto;padding:28px 20px;">
        <div style="background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e4edf1;">
          <p style="font:800 20px Arial,sans-serif;color:#16252d;margin:0 0 6px;">MVEC</p>
          <h2 style="margin:14px 0 10px;color:#16252d;">${title}</h2>
          <p style="color:#45565e;line-height:1.6;margin:0 0 18px;">${body}</p>
          ${
            url
              ? `<p style="text-align:center;">
                  <a href="${url}" style="background:#25addb;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Open in MVEC</a>
                </p>`
              : ""
          }
          <p style="font-size:12px;color:#8a969c;margin-top:22px;border-top:1px solid #edf0f2;padding-top:14px;">
            You're receiving this because of activity on your MVEC account.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * @param {object} params
 * @param {string} params.userId  - recipient user id
 * @param {string} params.type    - one of the NotificationType enum values
 * @param {string} params.title   - short title
 * @param {string} params.body    - message body
 * @param {string} [params.link]  - optional frontend deep link (e.g. "/orders/123")
 * @param {boolean} [params.email=true] - also send an email alert when the
 *   recipient has an email on file. Set to false for high-frequency/low-value
 *   events where an inbox alert would just be noise (e.g. typing indicators
 *   never call this at all, but something like "new message" could be muted
 *   this way if it ever gets noisy).
 */
async function notify({ userId, type = "SYSTEM", title, body, link, email = true }) {
  if (!userId || !title || !body) return null;

  let record = null;
  try {
    record = await prisma.notification.create({
      data: { userId, type, title, body, link: link || null },
    });
  } catch (error) {
    console.error("notify() failed to persist notification:", error.message);
  }

  if (email) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: title,
          text: body,
          html: renderEmail(title, body, link),
        });
      }
    } catch (error) {
      console.error("notify() failed to send email:", error.message);
    }
  }

  return record;
}

/** Send the same notification to several users at once (e.g. all vendors in an order). */
async function notifyMany(userIds, payload) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  await Promise.all(uniqueIds.map((userId) => notify({ ...payload, userId })));
}

module.exports = { notify, notifyMany };
