const prisma = require("../lib/prisma");

const cartInclude = {
  items: {
    include: {
      product: {
        select: {
          id: true, name: true, price: true, discountPrice: true, stockQuantity: true, status: true,
          mainImage: true, vendorId: true,
          vendor: { select: { fullName: true, companyName: true } },
        },
      },
    },
  },
};

const recalcTotal = (items) => items.reduce((sum, item) => sum + item.price * item.quantity, 0);

// @desc    Get user's shopping cart
// @route   GET /api/cart
exports.getCart = async (req, res) => {
  try {
    let cart = await prisma.cart.findUnique({ where: { userId: req.user.id }, include: cartInclude });

    if (!cart) {
      cart = await prisma.cart.create({ data: { userId: req.user.id, totalAmount: 0 }, include: cartInclude });
    }

    return res.status(200).json({ cart });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Add item to cart (Blocks vendors from buying their own items)
// @route   POST /api/cart
exports.addToCart = async (req, res) => {
  try {
    const { productId, quantity = 1 } = req.body;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (product.vendorId === req.user.id) {
      return res.status(403).json({ message: "Action denied. You cannot add your own product to your cart." });
    }

    if (product.status === "OUT_OF_STOCK" || product.stockQuantity < 1) {
      return res.status(400).json({ message: "Product is out of stock" });
    }

    let cart = await prisma.cart.findUnique({ where: { userId: req.user.id }, include: { items: true } });
    if (!cart) {
      cart = await prisma.cart.create({ data: { userId: req.user.id }, include: { items: true } });
    }

    const existingItem = cart.items.find((item) => item.productId === productId);
    const targetQuantity = existingItem ? existingItem.quantity + Number(quantity) : Number(quantity);

    if (targetQuantity > product.stockQuantity) {
      return res.status(400).json({
        message: `Cannot request more than available stock (${product.stockQuantity} remaining)`,
      });
    }

    const activePrice = product.discountPrice || product.price;

    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: targetQuantity, price: activePrice },
      });
    } else {
      await prisma.cartItem.create({
        data: { cartId: cart.id, productId, quantity: targetQuantity, price: activePrice },
      });
    }

    const items = await prisma.cartItem.findMany({ where: { cartId: cart.id } });
    await prisma.cart.update({ where: { id: cart.id }, data: { totalAmount: recalcTotal(items) } });

    const updatedCart = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
    return res.status(200).json({ message: "Item added to cart", cart: updatedCart });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Update cart item quantity
// @route   PUT /api/cart/items/:productId
exports.updateCartItemQuantity = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity } = req.body;

    if (quantity < 1) {
      return res.status(400).json({ message: "Quantity must be at least 1" });
    }

    const cart = await prisma.cart.findUnique({ where: { userId: req.user.id }, include: { items: true } });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const item = cart.items.find((i) => i.productId === productId);
    if (!item) {
      return res.status(404).json({ message: "Item not in cart" });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || quantity > product.stockQuantity) {
      return res.status(400).json({
        message: `Requested quantity exceeds available stock (${product ? product.stockQuantity : 0})`,
      });
    }

    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: Number(quantity) } });

    const items = await prisma.cartItem.findMany({ where: { cartId: cart.id } });
    await prisma.cart.update({ where: { id: cart.id }, data: { totalAmount: recalcTotal(items) } });

    const updatedCart = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
    return res.status(200).json({ message: "Cart updated", cart: updatedCart });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Remove item from cart
// @route   DELETE /api/cart/items/:productId
exports.removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;

    const cart = await prisma.cart.findUnique({ where: { userId: req.user.id } });
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });

    const items = await prisma.cartItem.findMany({ where: { cartId: cart.id } });
    await prisma.cart.update({ where: { id: cart.id }, data: { totalAmount: recalcTotal(items) } });

    const updatedCart = await prisma.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
    return res.status(200).json({ message: "Item removed from cart", cart: updatedCart });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// @desc    Clear all items in cart
// @route   DELETE /api/cart
exports.clearCart = async (req, res) => {
  try {
    const cart = await prisma.cart.findUnique({ where: { userId: req.user.id } });
    if (cart) {
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await prisma.cart.update({ where: { id: cart.id }, data: { totalAmount: 0 } });
    }
    return res.status(200).json({ message: "Cart cleared" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
