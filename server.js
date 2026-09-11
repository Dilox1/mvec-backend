const express = require("express");
const http = require("http");
const dotenv = require("dotenv");
const helmet = require("helmet");
const morgan = require("morgan");
const cors = require("cors");

// Swagger setup
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const swaggerDocument = YAML.load("./swagger.yaml");

const prisma = require("./src/lib/prisma");
const { initBackgroundWorkers } = require("./src/workers/slaWorker");
const socketService = require("./src/services/socket.service");

dotenv.config();

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: "*",
    credentials: true,
  }),
);
app.use(express.json());
app.use(morgan("dev"));

app.use("/api/auth", require("./src/routes/auth.routes"));
app.use("/api/users", require("./src/routes/user.routes"));
app.use("/api/search", require("./src/routes/search.routes"));
app.use("/api/products", require("./src/routes/product.routes"));
app.use("/api/categories", require("./src/routes/category.routes"));
app.use("/api/admin/suppliers", require("./src/routes/admin.supplier.routes"));
app.use("/api/suppliers", require("./src/routes/supplier.routes"));
app.use("/api/cart", require("./src/routes/cart.routes"));
app.use("/api/orders", require("./src/routes/order.routes"));
app.use("/api/reviews", require("./src/routes/review.routes"));
app.use("/api/stores", require("./src/routes/store.routes"));
app.use("/api/payouts", require("./src/routes/payout.routes"));
app.use("/api/staff", require("./src/routes/staff.routes"));
app.use("/api/payments", require("./src/routes/payment.routes"));
app.use("/api/admin", require("./src/routes/admin.financial.routes"));
app.use("/api/admin", require("./src/routes/admin.commission.routes"));
app.use("/api/wholesale", require("./src/routes/wholesale.routes"));
app.use("/api/disputes", require("./src/routes/dispute.routes"));
app.use("/api/conversations", require("./src/routes/conversation.routes"));
app.use("/api/support", require("./src/routes/support.routes"));
app.use("/api/languages", require("./src/routes/language.routes"));
app.use("/api/admin", require("./src/routes/adminTranslation.routes"));
app.use("/api/vendors", require("./src/routes/vendor.routes"));
app.use("/api/admin/vendors", require("./src/routes/admin.vendor.routes"));
app.use("/api/admin/products", require("./src/routes/admin.product.routes"));
app.use("/api/admin/orders", require("./src/routes/admin.order.routes"));
app.use("/api/affiliates", require("./src/routes/affiliate.routes"));
app.use("/api/webhooks", require("./src/routes/webhook.routes"));
app.use("/api/notifications", require("./src/routes/notification.routes"));

// Swagger documentation route
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get("/", (req, res) => {
  res.json({
    message: "Multi-Vendor E-Commerce API is working!",
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found` });
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);

  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";

const httpServer = http.createServer(app);
socketService.init(httpServer);

async function start() {
  try {
    await prisma.$connect();
    console.log("✅ Connected to the database via Prisma");
  } catch (error) {
    console.error("❌ Error connecting to the database:", error.message);
    console.error("   Check DATABASE_URL in your .env file and that migrations have run (npx prisma migrate dev).");
  }

  initBackgroundWorkers();

  httpServer.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log("⚡ Real-time messaging (Socket.IO) is live on the same port.");
  });
}

start();

// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = app;
