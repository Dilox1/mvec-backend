// seedAdmin.js
// Seeds the super_admin account, a starter set of real marketplace
// categories, and 20 demo accounts: one account per role (vendor, buyer,
// supplier, affiliate, delivery, i.e. every non-admin role the system has)
// for each of 4 named people, so the app has real data to work with out of
// the box: categories, vendor storefronts, supplier profiles, affiliate
// wallets, and real deliverable emails for the vendor accounts.
//
// Run with: npm run seed
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const dotenv = require("dotenv");
const prisma = require("./src/lib/prisma");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const slugify = (str) =>
  str.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const SEED_PASSWORD = process.env.SEED_USER_PASSWORD || "password";

// ── 1. Super Admin ───────────────────────────────────────────────────────
async function seedAdmin() {
  const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || SEED_PASSWORD, 10);
  const existing = await prisma.user.findFirst({ where: { role: "super_admin" } });

  const adminData = {
    fullName: "Admin",
    email: process.env.ADMIN_EMAIL,
    password: hashedPassword,
    gender: "male",
    phone: "0788888880",
    role: "super_admin",
    isSellerEnabled: true,
  };

  const admin = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: adminData })
    : await prisma.user.create({ data: adminData });

  console.log("Admin user seeded:", admin.email);
  return admin;
}

// ── 2. Starter categories ────────────────────────────────────────────────
async function seedCategories() {
  const names = [
    "Electronics", "Phones", "Computers", "Fashion",
    "Home & Living", "Beauty", "Sports", "Automotive",
  ];

  for (const [index, name] of names.entries()) {
    const slug = slugify(name);
    await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, sortOrder: index, isFeatured: index < 6, active: true },
    });
  }

  console.log(`Seeded ${names.length} starter categories.`);
}

// ── 3. Demo people: a vendor + buyer + supplier account for each ────────
const DEMO_PEOPLE = [
  { fullName: "Gourshant", vendorEmail: "thedebugger001@gmail.com" },
  { fullName: "Paccific", vendorEmail: "pacuiyo91@gmail.com" },
  { fullName: "Narada", vendorEmail: "naradaishimwe74@gmail.com" },
  { fullName: "Sharif", vendorEmail: "sharifbazimya17@gmail.com" },
];

async function upsertUser({ fullName, email, phone, role, companyName }, hashedPassword) {
  const existing = await prisma.user.findUnique({ where: { email } });
  const data = {
    fullName,
    email,
    phone,
    password: hashedPassword,
    gender: "other",
    role,
    companyName: companyName || undefined,
  };

  return existing
    ? prisma.user.update({ where: { id: existing.id }, data })
    : prisma.user.create({ data });
}

async function seedDemoPeople() {
  const hashedPassword = await bcrypt.hash(SEED_PASSWORD, 10);

  for (const [i, person] of DEMO_PEOPLE.entries()) {
    const n = i + 1; // user1..user4
    const phoneBase = `07880000${String(n).padStart(2, "0")}`;

    // ── Vendor account (real, deliverable email) ──────────────────────
    const vendorUser = await upsertUser(
      {
        fullName: person.fullName,
        email: person.vendorEmail,
        phone: `${phoneBase}1`,
        role: "vendor",
        companyName: `${person.fullName} Store`,
      },
      hashedPassword,
    );

    const vendorSlug = slugify(`${person.fullName}-store-${n}`);
    await prisma.vendor.upsert({
      where: { userId: vendorUser.id },
      update: {},
      create: {
        publicId: `MVEC-VND-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        userId: vendorUser.id,
        businessName: `${person.fullName} Store`,
        slug: vendorSlug,
        description: `${person.fullName}'s official store on MVEC.`,
        phone: `${phoneBase}1`,
        email: person.vendorEmail,
        verificationStatus: "VERIFIED",
        status: "ACTIVE",
      },
    });
    await prisma.user.update({ where: { id: vendorUser.id }, data: { isSellerEnabled: true } });

    const storeSlug = slugify(`${person.fullName}-shop-${n}`);
    await prisma.store.upsert({
      where: { vendorId: vendorUser.id },
      update: {},
      create: {
        vendorId: vendorUser.id,
        storeName: `${person.fullName} Shop`,
        slug: storeSlug,
        contactEmail: person.vendorEmail,
        contactPhone: `${phoneBase}1`,
        status: "ACTIVE",
      },
    });

    // ── Buyer account ────────────────────────────────────────────────
    await upsertUser(
      {
        fullName: person.fullName,
        email: `user${n}buyer@gmail.com`,
        phone: `${phoneBase}2`,
        role: "buyer",
      },
      hashedPassword,
    );

    // ── Supplier account ─────────────────────────────────────────────
    const supplierUser = await upsertUser(
      {
        fullName: person.fullName,
        email: `user${n}supplier@gmail.com`,
        phone: `${phoneBase}3`,
        role: "supplier",
        companyName: `${person.fullName} Supplies`,
      },
      hashedPassword,
    );

    const supplierSlug = slugify(`${person.fullName}-supplies-${n}`);
    await prisma.supplier.upsert({
      where: { userId: supplierUser.id },
      update: {},
      create: {
        publicId: `MVEC-SUP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        userId: supplierUser.id,
        businessName: `${person.fullName} Supplies`,
        slug: supplierSlug,
        phone: `${phoneBase}3`,
        email: `user${n}supplier@gmail.com`,
        verificationStatus: "VERIFIED",
        status: "ACTIVE",
      },
    });

    // ── Affiliate account ─────────────────────────────────────────────
    const affiliateUser = await upsertUser(
      {
        fullName: person.fullName,
        email: `user${n}affiliate@gmail.com`,
        phone: `${phoneBase}4`,
        role: "affiliate",
      },
      hashedPassword,
    );
    await prisma.affiliateWallet.upsert({
      where: { affiliateUserId: affiliateUser.id },
      update: {},
      create: { affiliateUserId: affiliateUser.id },
    });

    // ── Delivery partner account ───────────────────────────────────────
    await upsertUser(
      {
        fullName: person.fullName,
        email: `user${n}delivery@gmail.com`,
        phone: `${phoneBase}5`,
        role: "delivery",
      },
      hashedPassword,
    );

    console.log(
      `Seeded ${person.fullName}: vendor(${person.vendorEmail}), buyer(user${n}buyer@gmail.com), supplier(user${n}supplier@gmail.com), affiliate(user${n}affiliate@gmail.com), delivery(user${n}delivery@gmail.com)`,
    );
  }
}

async function run() {
  try {
    await seedAdmin();
    await seedCategories();
    await seedDemoPeople();
    console.log("\nSeeding complete. All demo accounts use the password set in SEED_USER_PASSWORD (see .env.example).");
  } catch (error) {
    console.error("Error seeding data:", error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
