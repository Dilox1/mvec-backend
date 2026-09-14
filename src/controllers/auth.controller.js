const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const prisma = require("../lib/prisma");
const { sendEmail } = require("../utils/email.util");
const { normalizePhone, phoneVariants, generateOtpCode, sendOtpSms } = require("../utils/sms.util");

// ─── HELPER: GOOGLE OAUTH CLIENT ─────────────────────────────────────────────
const getGoogleClient = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured. Add it to your .env file.");
  }
  return new OAuth2Client(clientId);
};

// ─── HELPER: SIGN JWT & BUILD SANITIZED USER RESPONSE ───────────────────────
const signToken = (userId) =>
  jwt.sign({ userId: userId.toString() }, process.env.JWT_SECRET, { expiresIn: "1d" });

const buildUserResponse = (u) => ({
  _id: u.id,
  id: u.id,
  Fullname: u.fullName,
  email: u.email || null,
  role: u.role,
  phone: u.phone || null,
  gender: u.gender || null,
  companyName: u.companyName || null,
  isSellerEnabled: u.isSellerEnabled || false,
});

// ─── REGISTER USER ───────────────────────────────────────────────────────────
exports.registerUser = async (req, res) => {
  try {
    const { Fullname, email, password, gender, phone, role, companyName, verificationToken } = req.body;

    if (!Fullname || !password || !gender || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!phone && !verificationToken) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    if (role === "vendor" && !companyName) {
      return res.status(400).json({ message: "Company name is required" });
    }

    let verifiedPhone = null;
    if (verificationToken) {
      let decoded;
      try {
        decoded = jwt.verify(verificationToken, process.env.JWT_SECRET);
      } catch {
        return res.status(400).json({ message: "Invalid or expired phone verification. Please re-verify." });
      }
      if (decoded.purpose !== "registration" || !normalizePhone(decoded.phone)) {
        return res.status(400).json({ message: "Invalid phone verification token" });
      }
      verifiedPhone = normalizePhone(decoded.phone);

      if (phone) {
        const bodyPhone = normalizePhone(phone);
        if (bodyPhone !== verifiedPhone) {
          return res.status(400).json({ message: "Phone number does not match the verified phone number." });
        }
      }
    } else {
      verifiedPhone = normalizePhone(phone);
    }

    if (!verifiedPhone) {
      return res.status(400).json({
        message: "A valid Rwandan phone number is required (e.g. 0788123456 or +250781234567)",
      });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : undefined;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
          { phone: { in: phoneVariants(verifiedPhone) } },
        ],
      },
    });

    if (existingUser) {
      const isEmailMatch = normalizedEmail && existingUser.email === normalizedEmail;
      return res.status(400).json({
        message: isEmailMatch ? "User with this email already exists" : "User with this phone number already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        fullName: Fullname.trim(),
        email: normalizedEmail,
        password: hashedPassword,
        gender,
        phone: verifiedPhone,
        role,
        companyName: role === "vendor" ? companyName.trim() : undefined,
      },
    });

    const token = signToken(newUser.id);

    return res.status(201).json({
      message: "User registered successfully",
      user: buildUserResponse(newUser),
      token,
    });
  } catch (error) {
    console.error("Error registering user:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── LOGIN USER ──────────────────────────────────────────────────────────────
exports.loginUser = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
      return res.status(400).json({ message: "Email or phone and password are required" });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const phoneVariantsList = phone ? phoneVariants(phone) : [];

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
          ...(phoneVariantsList.length ? [{ phone: { in: phoneVariantsList } }] : []),
        ],
      },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid email/phone or password" });
    }

    if (!user.password && user.googleId) {
      return res.status(400).json({
        message: "This account was created using Google Sign-In. Please log in with Google.",
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Invalid email/phone or password" });
    }

    if (user.accountStatus === "BLOCKED") {
      return res.status(403).json({
        message: "Your account has been blocked by MVEC administration. Contact support for assistance.",
      });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "1d" });

    return res.status(200).json({
      message: "Login successful",
      user: buildUserResponse(user),
      token,
    });
  } catch (error) {
    console.error("Error logging in user:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── GOOGLE SIGN-IN ──────────────────────────────────────────────────────────
exports.googleLogin = async (req, res) => {
  try {
    const idToken = req.body.idToken || req.body.token;
    const requestedRole = req.body.role;

    if (!idToken || typeof idToken !== "string") {
      return res.status(400).json({ message: "Google ID token is required" });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(500).json({
        message: "Google Sign-In is not configured. Please set GOOGLE_CLIENT_ID in the backend environment.",
      });
    }

    const client = getGoogleClient();
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });

    const payload = ticket.getPayload();
    const { email, name, sub: googleId, email_verified } = payload;

    if (!email) {
      return res.status(400).json({ message: "Your Google account has no email address we can use." });
    }

    const normalizedEmail = email.toLowerCase();

    let user = await prisma.user.findUnique({ where: { googleId } });

    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (byEmail) {
        user = await prisma.user.update({ where: { id: byEmail.id }, data: { googleId } });
      }
    }

    if (!user) {
      const allowedRoles = ["buyer", "vendor", "supplier", "affiliate", "delivery"];
      const role = allowedRoles.includes(requestedRole) ? requestedRole : "buyer";

      user = await prisma.user.create({
        data: {
          fullName: name || "Google User",
          email: normalizedEmail,
          googleId,
          role,
          emailVerified: Boolean(email_verified),
        },
      });
    }

    if (user.accountStatus === "BLOCKED") {
      return res.status(403).json({
        message: "Your account has been blocked by MVEC administration. Contact support for assistance.",
      });
    }

    const token = signToken(user.id);

    return res.status(200).json({
      message: "Google sign-in successful",
      user: buildUserResponse(user),
      token,
    });
  } catch (error) {
    if (error.message && error.message.includes("GOOGLE_CLIENT_ID")) {
      return res.status(500).json({ message: error.message });
    }
    if (
      error.message &&
      /invalid token|wrong number of segments|audience|no pem|key id|token used too late|could not retrieve/i.test(
        error.message,
      )
    ) {
      return res.status(401).json({ message: "Invalid Google ID token" });
    }
    console.error("Error logging in with Google:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// PASSWORD RESET: OTP-by-email flow
// 1. forgotPassword    -> emails a 6-digit code
// 2. verifyResetOtp    -> checks the code, issues a short-lived reset token
// 3. resetPassword     -> takes the reset token + new password
const sendResetOtpEmail = async (toEmail, code) => {
  await sendEmail({
    to: toEmail,
    subject: "Your MVEC password reset code",
    text: `Your MVEC password reset code is ${code}. It expires in 10 minutes. If you did not request this, please ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          .container { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; }
          .header { text-align: center; border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; }
          .code { font-size: 34px; font-weight: 800; letter-spacing: 10px; text-align: center; color: #16a34a; margin: 20px 0; }
          .footer { font-size: 12px; color: #888; margin-top: 25px; border-top: 1px solid #eee; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h2>Password Reset Code</h2></div>
          <p>Hello,</p>
          <p>Use the code below to reset your MVEC account password. Enter it on the verification page to continue.</p>
          <p class="code">${code}</p>
          <p><strong>Note:</strong> This code is valid for 10 minutes only. If you did not request this, please ignore this email, your password will not be changed.</p>
          <div class="footer"><p>&copy; ${new Date().getFullYear()} MVEC. All rights reserved.</p></div>
        </div>
      </body>
      </html>
    `,
    throwOnError: true,
  });
};

const RESET_OTP_TTL_MS = 10 * 60 * 1000;
const RESET_OTP_COOLDOWN_MS = 45 * 1000;
const RESET_OTP_MAX_ATTEMPTS = 5;

// 1. FORGOT PASSWORD: send a 6-digit code by email
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const genericResponse = {
      message: "If an account exists with that email, a verification code has been sent.",
    };

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(200).json(genericResponse);
    }

    if (!user.password && user.googleId) {
      return res.status(400).json({
        message: "This account was created using Google Sign-In. Please log in with Google.",
      });
    }

    const recent = await prisma.otp.findFirst({
      where: {
        email: normalizedEmail,
        purpose: "password_reset",
        lastSentAt: { gt: new Date(Date.now() - RESET_OTP_COOLDOWN_MS) },
      },
    });
    if (recent) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil(RESET_OTP_COOLDOWN_MS / 1000)}s before requesting a new code.`,
      });
    }

    const code = generateOtpCode(6);
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");

    await prisma.otp.updateMany({
      where: { email: normalizedEmail, purpose: "password_reset", consumed: false },
      data: { consumed: true },
    });

    await prisma.otp.create({
      data: {
        email: normalizedEmail,
        codeHash,
        purpose: "password_reset",
        expiresAt: new Date(Date.now() + RESET_OTP_TTL_MS),
        attempts: 0,
        lastSentAt: new Date(),
        consumed: false,
      },
    });

    try {
      await sendResetOtpEmail(user.email, code);
      return res.status(200).json({
        ...genericResponse,
        ...(process.env.NODE_ENV === "development" && { devCode: code }),
      });
    } catch (emailError) {
      console.error("Email Sending Error:", emailError.message);
      return res.status(500).json({ message: "Could not send the verification code email. Please try again later." });
    }
  } catch (error) {
    console.error("Forgot Password Error:", error);
    return res.status(500).json({ message: "Failed to process request" });
  }
};

// 2. VERIFY RESET OTP: check the code, issue a short-lived reset token
exports.verifyResetOtp = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ message: "A 6-digit verification code is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const codeHash = crypto.createHash("sha256").update(code.trim()).digest("hex");

    const otp = await prisma.otp.findFirst({
      where: {
        email: normalizedEmail,
        purpose: "password_reset",
        consumed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) {
      return res.status(400).json({ message: "Invalid or expired code. Please try again." });
    }

    if (otp.codeHash !== codeHash) {
      const attempts = otp.attempts + 1;
      const exhausted = attempts >= RESET_OTP_MAX_ATTEMPTS;
      await prisma.otp.update({
        where: { id: otp.id },
        data: { attempts, consumed: exhausted ? true : otp.consumed },
      });
      if (exhausted) {
        return res.status(429).json({ message: "Too many failed attempts. Please request a new code." });
      }
      return res.status(400).json({ message: "Invalid or expired code. Please try again." });
    }

    await prisma.otp.update({ where: { id: otp.id }, data: { consumed: true } });

    const resetToken = jwt.sign({ email: normalizedEmail, purpose: "password_reset" }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    return res.status(200).json({ message: "Code verified.", verified: true, resetToken });
  } catch (error) {
    console.error("Verify Reset OTP Error:", error);
    return res.status(500).json({ message: "Failed to verify code" });
  }
};

// 3. RESET PASSWORD: takes the verified reset token + new password
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || typeof resetToken !== "string") {
      return res.status(400).json({ message: "A verified reset token is required. Please verify your code again." });
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ message: "Password is required and must be at least 6 characters long" });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({ message: "Your verification session expired. Please request a new code." });
    }

    if (decoded.purpose !== "password_reset" || !decoded.email) {
      return res.status(400).json({ message: "Invalid reset token." });
    }

    const user = await prisma.user.findUnique({ where: { email: decoded.email } });
    if (!user) {
      return res.status(404).json({ message: "Account not found." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });

    return res.status(200).json({
      message: "Password reset successful! You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── 3. USER ADDRESSES ───────────────────────────────────────────────────────
exports.addAddress = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      type,
      country,
      provinceState,
      cityDistrict,
      street,
      building,
      apartment,
      postalCode,
      phone,
      deliveryInstructions,
      isDefaultShipping,
      isDefaultBilling,
    } = req.body;

    const existingCount = await prisma.address.count({ where: { userId } });
    const isFirstAddress = existingCount === 0;

    await prisma.$transaction(async (tx) => {
      if (isDefaultShipping) {
        await tx.address.updateMany({ where: { userId }, data: { isDefaultShipping: false } });
      }
      if (isDefaultBilling) {
        await tx.address.updateMany({ where: { userId }, data: { isDefaultBilling: false } });
      }

      await tx.address.create({
        data: {
          userId,
          type: type || "HOME",
          country,
          provinceState,
          cityDistrict,
          street,
          building,
          apartment,
          postalCode,
          phone,
          deliveryInstructions,
          isDefaultShipping: isFirstAddress ? true : Boolean(isDefaultShipping),
          isDefaultBilling: isFirstAddress ? true : Boolean(isDefaultBilling),
        },
      });
    });

    const addresses = await prisma.address.findMany({ where: { userId } });
    return res.status(201).json({ message: "Address added successfully", addresses });
  } catch (error) {
    console.error("Error adding address:", error);
    return res.status(400).json({ message: error.message });
  }
};

exports.getAddresses = async (req, res) => {
  try {
    const addresses = await prisma.address.findMany({ where: { userId: req.user.id } });
    return res.status(200).json({ addresses });
  } catch (error) {
    console.error("Error fetching addresses:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.updateAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    const address = await prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    const { isDefaultShipping, isDefaultBilling, id, userId: _uid, ...updateFields } = req.body;

    await prisma.$transaction(async (tx) => {
      if (isDefaultShipping) {
        await tx.address.updateMany({ where: { userId }, data: { isDefaultShipping: false } });
      }
      if (isDefaultBilling) {
        await tx.address.updateMany({ where: { userId }, data: { isDefaultBilling: false } });
      }

      await tx.address.update({
        where: { id: addressId },
        data: {
          ...updateFields,
          ...(typeof isDefaultShipping !== "undefined" && { isDefaultShipping: Boolean(isDefaultShipping) }),
          ...(typeof isDefaultBilling !== "undefined" && { isDefaultBilling: Boolean(isDefaultBilling) }),
        },
      });
    });

    const addresses = await prisma.address.findMany({ where: { userId } });
    return res.status(200).json({ message: "Address updated successfully", addresses });
  } catch (error) {
    console.error("Error updating address:", error);
    return res.status(400).json({ message: error.message });
  }
};

exports.deleteAddress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { addressId } = req.params;

    const address = await prisma.address.findFirst({ where: { id: addressId, userId } });
    if (!address) {
      return res.status(404).json({ message: "Address not found" });
    }

    await prisma.address.delete({ where: { id: addressId } });

    const remaining = await prisma.address.findMany({ where: { userId } });
    if (remaining.length > 0) {
      if (address.isDefaultShipping && !remaining.some((a) => a.isDefaultShipping)) {
        await prisma.address.update({ where: { id: remaining[0].id }, data: { isDefaultShipping: true } });
      }
      if (address.isDefaultBilling && !remaining.some((a) => a.isDefaultBilling)) {
        await prisma.address.update({ where: { id: remaining[0].id }, data: { isDefaultBilling: true } });
      }
    }

    const addresses = await prisma.address.findMany({ where: { userId } });
    return res.status(200).json({ message: "Address deleted successfully", addresses });
  } catch (error) {
    console.error("Error deleting address:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

// ─── OTP: SEND VERIFICATION CODE ────────────────────────────────────────────
exports.sendOtp = async (req, res) => {
  try {
    const { phone, purpose, email } = req.body;

    const validPurposes = ["registration", "login"];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({ message: `purpose must be one of: ${validPurposes.join(", ")}` });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({
        message: "A valid Rwandan phone number is required (e.g. 0788123456 or +250781234567)",
      });
    }

    const otpTtlSeconds = Number(process.env.OTP_EXPIRY_SECONDS || 300);
    const cooldownSeconds = Number(process.env.OTP_COOLDOWN_SECONDS || 60);

    const recent = await prisma.otp.findFirst({
      where: {
        phone: normalizedPhone,
        purpose,
        lastSentAt: { gt: new Date(Date.now() - cooldownSeconds * 1000) },
      },
    });
    if (recent) {
      return res.status(429).json({ message: `Please wait ${cooldownSeconds}s before requesting a new code.` });
    }

    const code = generateOtpCode(6);
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");

    await prisma.otp.updateMany({
      where: { phone: normalizedPhone, purpose, consumed: false },
      data: { consumed: true },
    });

    await prisma.otp.create({
      data: {
        phone: normalizedPhone,
        codeHash,
        purpose,
        email: email ? email.trim().toLowerCase() : undefined,
        expiresAt: new Date(Date.now() + otpTtlSeconds * 1000),
        attempts: 0,
        lastSentAt: new Date(),
        consumed: false,
      },
    });

    await sendOtpSms(normalizedPhone, code, { purpose });

    return res.status(200).json({
      message: `Verification code sent to ${normalizedPhone}`,
      ...(process.env.NODE_ENV === "development" && { devCode: code }),
    });
  } catch (error) {
    console.error("Error sending OTP:", error);
    return res.status(500).json({ message: "Failed to send verification code" });
  }
};

// ─── OTP: VERIFY & CONSUME CODE ─────────────────────────────────────────────
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, code, purpose, role } = req.body;

    const validPurposes = ["registration", "login"];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({ message: `purpose must be one of: ${validPurposes.join(", ")}` });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({
        message: "A valid Rwandan phone number is required (e.g. 0788123456 or +250781234567)",
      });
    }

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code.trim())) {
      return res.status(400).json({ message: "A 6-digit verification code is required" });
    }

    const codeHash = crypto.createHash("sha256").update(code.trim()).digest("hex");

    const otp = await prisma.otp.findFirst({
      where: { phone: normalizedPhone, purpose, consumed: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) {
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 5);

    if (otp.codeHash !== codeHash) {
      const attempts = otp.attempts + 1;
      const exhausted = attempts >= maxAttempts;
      await prisma.otp.update({
        where: { id: otp.id },
        data: { attempts, consumed: exhausted ? true : otp.consumed },
      });
      if (exhausted) {
        return res.status(429).json({ message: "Too many failed attempts. Please request a new code." });
      }
      return res.status(400).json({ message: "Invalid or expired verification code" });
    }

    await prisma.otp.update({ where: { id: otp.id }, data: { consumed: true } });

    // ── PURPOSE: PASSWORDLESS LOGIN ─────────────────────────────────────────
    if (purpose === "login") {
      const user = await prisma.user.findFirst({ where: { phone: { in: phoneVariants(normalizedPhone) } } });

      if (!user) {
        return res.status(404).json({
          message: "No account is linked to this phone number. Please register first.",
        });
      }

      if (user.accountStatus === "BLOCKED") {
        return res.status(403).json({
          message: "Your account has been blocked by MVEC administration. Contact support for assistance.",
        });
      }

      const token = signToken(user.id);
      return res.status(200).json({
        message: "Phone verified, you are now signed in",
        user: buildUserResponse(user),
        token,
        verified: true,
      });
    }

    // ── PURPOSE: REGISTRATION ───────────────────────────────────────────────
    const allowedRoles = ["buyer", "vendor", "supplier", "affiliate", "delivery"];
    const finalRole = allowedRoles.includes(role) ? role : "buyer";
    const verificationToken = jwt.sign(
      { phone: normalizedPhone, purpose, role: finalRole },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    return res.status(200).json({
      message: "Phone verified successfully. Complete your registration.",
      verificationToken,
      phone: normalizedPhone,
      verified: true,
    });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res.status(500).json({ message: "Failed to verify code" });
  }
};
