const prisma = require("../lib/prisma");

const generateTicketNumber = () => `TKT-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;

// @desc    Open a new support ticket
// @route   POST /api/support/cases
exports.createSupportCase = async (req, res) => {
  try {
    const { subject, category, priority, description } = req.body;

    if (!subject || !description) {
      return res.status(400).json({ message: "Subject and description are required" });
    }

    const supportCase = await prisma.supportCase.create({
      data: {
        ticketNumber: generateTicketNumber(),
        openedById: req.user.id,
        subject,
        category: category || "OTHER",
        priority: priority || "MEDIUM",
        description,
      },
    });

    return res.status(201).json({ message: "Support ticket created successfully", case: supportCase });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Fetch details and updates on an active case
// @route   GET /api/support/cases/:id
exports.getSupportCaseById = async (req, res) => {
  try {
    const { id } = req.params;

    const supportCase = await prisma.supportCase.findUnique({
      where: { id },
      include: {
        openedBy: { select: { fullName: true, email: true, role: true } },
        assignedTo: { select: { fullName: true, email: true } },
        comments: { include: { author: { select: { fullName: true, email: true, role: true } } }, orderBy: { createdAt: "asc" } },
      },
    });

    if (!supportCase) {
      return res.status(404).json({ message: "Support case not found" });
    }

    const isOwner = supportCase.openedById === req.user.id;
    const isAdmin = ["admin", "super_admin", "support"].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Access denied to this support case" });
    }

    return res.status(200).json({ case: supportCase });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Add comment/update to a support case
// @route   POST /api/support/cases/:id/comments
exports.addCaseComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, attachments } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Comment message is required" });
    }

    const supportCase = await prisma.supportCase.findUnique({ where: { id } });
    if (!supportCase) {
      return res.status(404).json({ message: "Support case not found" });
    }

    const isOwner = supportCase.openedById === req.user.id;
    const isAdmin = ["admin", "super_admin", "support"].includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Access denied" });
    }

    await prisma.caseComment.create({
      data: { supportCaseId: id, authorId: req.user.id, message, attachments: attachments || [] },
    });

    if (isOwner && supportCase.status === "RESOLVED") {
      await prisma.supportCase.update({ where: { id }, data: { status: "IN_PROGRESS" } });
    }

    const comments = await prisma.caseComment.findMany({
      where: { supportCaseId: id },
      include: { author: { select: { fullName: true, email: true, role: true } } },
      orderBy: { createdAt: "asc" },
    });

    return res.status(200).json({ message: "Comment added", comments });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
