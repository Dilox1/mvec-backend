const prisma = require("../lib/prisma");

/**
 * 1. Locks incoming buyer payment into Escrow
 */
async function lockPaymentInEscrow({ orderId, vendorId, grossAmount, commissionAmount, tx = prisma }) {
  const netAmount = grossAmount - commissionAmount;

  let escrowAccount = await tx.ledgerAccount.findFirst({ where: { accountType: "ESCROW_HOLDING" } });
  if (!escrowAccount) {
    escrowAccount = await tx.ledgerAccount.create({
      data: { accountNumber: "ACC-ESCROW-001", accountType: "ESCROW_HOLDING", balance: 0 },
    });
  }

  let vendorAccount = await tx.ledgerAccount.findFirst({
    where: { ownerId: vendorId, accountType: "VENDOR_PAYABLE" },
  });
  if (!vendorAccount) {
    vendorAccount = await tx.ledgerAccount.create({
      data: { accountNumber: `ACC-VENDOR-${vendorId}`, accountType: "VENDOR_PAYABLE", ownerId: vendorId, balance: 0 },
    });
  }

  await tx.ledgerAccount.update({
    where: { id: escrowAccount.id },
    data: { balance: { increment: grossAmount } },
  });

  await tx.ledgerEntry.create({
    data: {
      transactionReference: `MVEC-TXN-${Date.now()}`,
      debitAccountId: escrowAccount.id,
      creditAccountId: vendorAccount.id,
      amount: grossAmount,
      entryType: "PAYMENT_ESCROW_LOCK",
      relatedOrderId: orderId,
      description: `Escrow hold for Order #${orderId}`,
    },
  });

  const settlement = await tx.settlement.create({
    data: {
      settlementReference: `MVEC-SETTLE-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      orderId,
      vendorId,
      grossAmount,
      commissionAmount,
      netAmount,
      status: "HELD",
    },
  });

  await tx.vendorWallet.upsert({
    where: { vendorId },
    update: { pendingBalance: { increment: netAmount } },
    create: { vendorId, pendingBalance: netAmount, availableBalance: 0, totalEarned: 0 },
  });

  return settlement;
}

/**
 * 2. Releases Escrow Funds to Vendor upon OTP Delivery Confirmation or Super Admin Override
 */
async function releaseEscrowToVendor({ settlementId, tx = prisma }) {
  const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
  if (!settlement) {
    throw new Error("Settlement not found.");
  }
  if (settlement.status !== "HELD") {
    throw new Error(`Settlement is not eligible for release with status: ${settlement.status}`);
  }

  let escrowAccount = await tx.ledgerAccount.findFirst({ where: { accountType: "ESCROW_HOLDING" } });
  if (!escrowAccount) {
    escrowAccount = await tx.ledgerAccount.create({
      data: { accountNumber: "ACC-ESCROW-001", accountType: "ESCROW_HOLDING", balance: 0 },
    });
  }

  let vendorAccount = await tx.ledgerAccount.findFirst({
    where: { ownerId: settlement.vendorId, accountType: "VENDOR_PAYABLE" },
  });
  if (!vendorAccount) {
    vendorAccount = await tx.ledgerAccount.create({
      data: {
        accountNumber: `ACC-VENDOR-${settlement.vendorId}`,
        accountType: "VENDOR_PAYABLE",
        ownerId: settlement.vendorId,
        balance: 0,
      },
    });
  }

  let platformAccount = await tx.ledgerAccount.findFirst({ where: { accountType: "PLATFORM_REVENUE" } });
  if (!platformAccount) {
    platformAccount = await tx.ledgerAccount.create({
      data: { accountNumber: "ACC-PLATFORM-REV", accountType: "PLATFORM_REVENUE", balance: 0 },
    });
  }

  await tx.ledgerAccount.update({
    where: { id: escrowAccount.id },
    data: { balance: { decrement: settlement.grossAmount } },
  });
  await tx.ledgerAccount.update({
    where: { id: vendorAccount.id },
    data: { balance: { increment: settlement.netAmount } },
  });
  await tx.ledgerAccount.update({
    where: { id: platformAccount.id },
    data: { balance: { increment: settlement.commissionAmount } },
  });

  const updatedSettlement = await tx.settlement.update({
    where: { id: settlement.id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });

  await tx.ledgerEntry.createMany({
    data: [
      {
        transactionReference: `MVEC-RELEASE-${Date.now()}`,
        debitAccountId: escrowAccount.id,
        creditAccountId: vendorAccount.id,
        amount: settlement.netAmount,
        entryType: "ESCROW_RELEASE_VENDOR",
        relatedOrderId: settlement.orderId,
        description: `Net payout released to vendor for settlement ${settlement.settlementReference}`,
      },
      {
        transactionReference: `MVEC-COMM-${Date.now()}`,
        debitAccountId: escrowAccount.id,
        creditAccountId: platformAccount.id,
        amount: settlement.commissionAmount,
        entryType: "PLATFORM_COMMISSION_DEDUCTION",
        relatedOrderId: settlement.orderId,
        description: `Platform commission deducted for settlement ${settlement.settlementReference}`,
      },
    ],
  });

  await tx.vendorWallet.update({
    where: { vendorId: settlement.vendorId },
    data: {
      pendingBalance: { decrement: settlement.netAmount },
      availableBalance: { increment: settlement.netAmount },
      totalEarned: { increment: settlement.netAmount },
    },
  });

  return updatedSettlement;
}

module.exports = { lockPaymentInEscrow, releaseEscrowToVendor };
