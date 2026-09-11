const prisma = require("../lib/prisma");

// @desc    Submit a review for a product tied to a completed order
// @route   POST /api/reviews
// @access  Private (Buyer)
exports.createReview = async (req, res) => {
  try {
    const { productId, parentOrderId, rating, reviewText, images } = req.body;

    if (!productId || !parentOrderId || !rating) {
      return res.status(400).json({ message: "productId, parentOrderId and rating are required" });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: "rating must be between 1 and 5" });
    }

    // Verify the buyer actually bought this product on this order
    const order = await prisma.order.findFirst({
      where: { id: parentOrderId, userId: req.user.id, items: { some: { productId } } },
    });

    const review = await prisma.review.create({
      data: {
        userId: req.user.id,
        productId,
        parentOrderId,
        rating: Number(rating),
        reviewText,
        images: images || [],
        isVerifiedPurchase: Boolean(order),
      },
    });

    // Recompute the product's average rating
    const agg = await prisma.review.aggregate({ where: { productId }, _avg: { rating: true } });
    await prisma.product.update({
      where: { id: productId },
      data: { averageRating: agg._avg.rating || 0 },
    });

    return res.status(201).json({ message: "Review submitted", review });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "You have already reviewed this product for this order." });
    }
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Get all reviews for a product
// @route   GET /api/reviews/product/:productId
// @access  Public
exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { productId },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.review.count({ where: { productId } }),
    ]);

    return res.status(200).json({ meta: { total, page: pageNum, limit: limitNum }, reviews });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update own review
// @route   PATCH /api/reviews/:id
// @access  Private
exports.updateReview = async (req, res) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (review.userId !== req.user.id) {
      return res.status(403).json({ message: "You can only edit your own review" });
    }

    const { rating, reviewText, images } = req.body;
    const data = {};
    if (rating !== undefined) data.rating = Number(rating);
    if (reviewText !== undefined) data.reviewText = reviewText;
    if (images !== undefined) data.images = images;

    const updated = await prisma.review.update({ where: { id: req.params.id }, data });

    const agg = await prisma.review.aggregate({ where: { productId: review.productId }, _avg: { rating: true } });
    await prisma.product.update({ where: { id: review.productId }, data: { averageRating: agg._avg.rating || 0 } });

    return res.status(200).json({ message: "Review updated", review: updated });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

// @desc    Delete own review (or admin deletes any)
// @route   DELETE /api/reviews/:id
// @access  Private
exports.deleteReview = async (req, res) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!review) return res.status(404).json({ message: "Review not found" });
    if (review.userId !== req.user.id && req.user.role !== "super_admin") {
      return res.status(403).json({ message: "Access denied" });
    }

    await prisma.review.delete({ where: { id: req.params.id } });

    const agg = await prisma.review.aggregate({ where: { productId: review.productId }, _avg: { rating: true } });
    await prisma.product.update({ where: { id: review.productId }, data: { averageRating: agg._avg.rating || 0 } });

    return res.status(200).json({ message: "Review deleted" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
