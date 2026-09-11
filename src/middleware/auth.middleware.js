const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId || decoded.id },
      });

      if (!user) {
        return res.status(401).json({ message: "User no longer exists" });
      }

      if (user.accountStatus === "BLOCKED") {
        return res.status(403).json({
          message: "Your account has been blocked by MVEC administration. Contact support for assistance.",
        });
      }

      const { password, ...safeUser } = user;
      // Normalize so controllers can keep using req.user.id / req.user._id.
      req.user = { ...safeUser, id: user.id, _id: user.id };

      return next();
    } catch (error) {
      console.error("Auth Middleware Error:", error.message);
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token provided" });
  }
};

// Restrict endpoint access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: `User role '${req.user.role}' is not authorized to access this route`,
      });
    }
    next();
  };
};
