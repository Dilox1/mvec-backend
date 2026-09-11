const prisma = require("../lib/prisma");

// @desc    Reconcile imported provider statement against ledger
// @route   POST /api/admin/reconcile
exports.runReconciliation = async (req, res) => {
  try {
    const { statements } = req.body;

    const reconciliationResults = {
      totalProcessed: statements.length,
      matched: 0,
      mismatched: 0,
      missingInLedger: 0,
    };

    for (const stmt of statements) {
      const webhookLog = await prisma.paymentWebhookLog.findUnique({
        where: { externalTransactionId: stmt.externalTransactionId },
      });

      let status = "MISSING_IN_LEDGER";

      if (webhookLog) {
        if (webhookLog.amount === stmt.amount && webhookLog.status === "PROCESSED") {
          status = "MATCHED";
          reconciliationResults.matched += 1;
        } else {
          status = "MISMATCHED";
          reconciliationResults.mismatched += 1;
        }
      } else {
        reconciliationResults.missingInLedger += 1;
      }

      await prisma.providerStatement.upsert({
        where: { externalTransactionId: stmt.externalTransactionId },
        update: {
          provider: stmt.provider,
          amount: stmt.amount,
          transactionDate: new Date(stmt.transactionDate),
          reconciliationStatus: status,
        },
        create: {
          provider: stmt.provider,
          externalTransactionId: stmt.externalTransactionId,
          amount: stmt.amount,
          transactionDate: new Date(stmt.transactionDate),
          reconciliationStatus: status,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Reconciliation completed successfully.",
      results: reconciliationResults,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
