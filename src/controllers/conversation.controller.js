const prisma = require("../lib/prisma");
const socketService = require("../services/socket.service");
const { notify } = require("../utils/notify.util");

const participantSelect = { id: true, fullName: true, email: true, companyName: true, role: true };

const unreadWhere = (userId) => ({
  senderId: { not: userId },
  NOT: { readByIds: { array_contains: userId } },
});

// @desc    Initialize or retrieve conversation thread
// @route   POST /api/conversations
exports.createConversation = async (req, res) => {
  try {
    const { recipientId, subject } = req.body;
    const senderId = req.user.id;

    if (!recipientId) {
      return res.status(400).json({ message: "Recipient ID is required" });
    }
    if (recipientId === senderId) {
      return res.status(400).json({ message: "Cannot create a conversation with yourself" });
    }

    const recipient = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) {
      return res.status(404).json({ message: "Recipient user not found" });
    }

    // A thread "exists" between exactly these two users if both are participants
    // and the conversation has exactly two participants.
    let conversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { some: { id: senderId } } },
          { participants: { some: { id: recipientId } } },
        ],
      },
      include: { participants: { select: participantSelect } },
    });

    if (conversation && conversation.participants.length !== 2) conversation = null;

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          subject: subject || "",
          participants: { connect: [{ id: senderId }, { id: recipientId }] },
        },
        include: { participants: { select: participantSelect } },
      });
    }

    return res.status(200).json({ conversation });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Get user's active conversations, each with an unread count
// @route   GET /api/conversations
exports.getConversations = async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { id: req.user.id } } },
      orderBy: { lastMessageAt: "desc" },
      include: { participants: { select: participantSelect } },
    });

    const withUnread = await Promise.all(
      conversations.map(async (c) => {
        const unreadCount = await prisma.message.count({
          where: { conversationId: c.id, ...unreadWhere(req.user.id) },
        });
        return { ...c, unreadCount };
      }),
    );

    return res.status(200).json({ conversations: withUnread });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Retrieve message history for thread
// @route   GET /api/conversations/:id/messages
exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 30 } = req.query;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { participants: { select: { id: true } } },
    });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation thread not found" });
    }

    const isParticipant = conversation.participants.some((p) => p.id === req.user.id);
    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied to this conversation" });
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 30, 100);

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: { sender: { select: { fullName: true, email: true, role: true } } },
      }),
      prisma.message.count({ where: { conversationId: id } }),
    ]);

    return res.status(200).json({
      meta: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      messages: messages.reverse(),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Send new message in active thread (persists, then pushes over
//          WebSocket to every other participant in real time, WhatsApp-style)
// @route   POST /api/conversations/:id/messages
exports.sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, attachments } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: "Message content is required" });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { participants: { select: { id: true, fullName: true } } },
    });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation thread not found" });
    }

    const isParticipant = conversation.participants.some((p) => p.id === req.user.id);
    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied to this conversation" });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        senderId: req.user.id,
        content: content.trim(),
        attachments: attachments || [],
        readByIds: [req.user.id],
      },
      include: { sender: { select: { fullName: true, email: true, role: true } } },
    });

    await prisma.conversation.update({
      where: { id },
      data: { lastMessage: content.trim(), lastMessageAt: new Date() },
    });

    const otherParticipants = conversation.participants.filter((p) => p.id !== req.user.id);

    // Real-time push: every other participant gets the message instantly if
    // they're online (connected to their `user:{id}` socket room).
    otherParticipants.forEach((p) => {
      socketService.emitToRoom(`user:${p.id}`, "new_message", {
        conversationId: id,
        message,
      });
    });

    // Offline fallback: a persisted notification so it still shows up in
    // their notification bell even if they weren't connected right now.
    for (const p of otherParticipants) {
      await notify({
        userId: p.id,
        type: "SYSTEM",
        title: `New message from ${req.user.fullName}`,
        body: content.trim().slice(0, 140),
        link: "/messages",
        email: false, // already delivered in real time via socket + in-app bell
      }).catch(() => null);
    }

    return res.status(201).json({ message });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Mark every unread message in a thread as read by me, and let the
//          sender know in real time (WhatsApp-style blue ticks)
// @route   PATCH /api/conversations/:id/read
exports.markConversationRead = async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { participants: { select: { id: true } } },
    });
    if (!conversation) {
      return res.status(404).json({ message: "Conversation thread not found" });
    }

    const isParticipant = conversation.participants.some((p) => p.id === req.user.id);
    if (!isParticipant) {
      return res.status(403).json({ message: "Access denied to this conversation" });
    }

    const unread = await prisma.message.findMany({
      where: { conversationId: id, ...unreadWhere(req.user.id) },
      select: { id: true, readByIds: true },
    });

    await Promise.all(
      unread.map((m) =>
        prisma.message.update({
          where: { id: m.id },
          data: { readByIds: [...(Array.isArray(m.readByIds) ? m.readByIds : []), req.user.id] },
        }),
      ),
    );

    if (unread.length > 0) {
      conversation.participants
        .filter((p) => p.id !== req.user.id)
        .forEach((p) => {
          socketService.emitToRoom(`user:${p.id}`, "messages_read", {
            conversationId: id,
            readerId: req.user.id,
            readAt: new Date(),
          });
        });
    }

    return res.status(200).json({ message: "Conversation marked as read", count: unread.length });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Search people to start a new conversation with (any authenticated user)
// @route   GET /api/conversations/contacts?q=
exports.searchContacts = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(200).json({ contacts: [] });
    }

    const contacts = await prisma.user.findMany({
      where: {
        id: { not: req.user.id },
        accountStatus: "ACTIVE",
        OR: [
          { fullName: { contains: q.trim() } },
          { email: { contains: q.trim() } },
          { companyName: { contains: q.trim() } },
        ],
      },
      select: participantSelect,
      take: 15,
    });

    return res.status(200).json({ contacts });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
