const express = require("express");
const router = express.Router();
const review = require("../controllers/review.controller");
const { protect } = require("../middleware/auth.middleware");

router.get("/product/:productId", review.getProductReviews);

router.use(protect);
router.post("/", review.createReview);
router.patch("/:id", review.updateReview);
router.delete("/:id", review.deleteReview);

module.exports = router;
