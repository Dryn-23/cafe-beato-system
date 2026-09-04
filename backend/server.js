const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
dns.setDefaultResultOrder('ipv4first');

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || "*"
}));
app.use(express.json());

/* ---------------------------------------------
   MODELS
--------------------------------------------- */

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);

const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true, trim: true },
  item: { type: String, required: true, trim: true },
  size: { type: String, enum: ["Small", "Medium", "Large"], default: "Medium" },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  notes: { type: String, trim: true, default: "" },
  price: { type: Number, required: true, min: 0 },
  status: {
    type: String,
    enum: ["pending", "preparing", "ready", "completed"],
    default: "pending"
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", orderSchema);

/* ---------------------------------------------
   AUTH MIDDLEWARE
--------------------------------------------- */

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

/* ---------------------------------------------
   HEALTH CHECK
--------------------------------------------- */

app.get("/", (req, res) => {
  res.json({ message: "Login API is running." });
});

/* ---------------------------------------------
   AUTH ROUTES
--------------------------------------------- */

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "All fields are required." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "Email is already registered." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      name,
      email,
      password: hashedPassword
    });

    res.status(201).json({ message: "Registration successful." });
  } catch (error) {
    res.status(500).json({ message: "Server error." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = jwt.sign(
      { userId: user._id, name: user.name, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      message: "Login successful.",
      token,
      user: {
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Server error." });
  }
});

app.get("/api/profile", requireAuth, async (req, res) => {
  res.json({
    message: "Protected data.",
    user: {
      name: req.user.name,
      email: req.user.email
    }
  });
});

/* ---------------------------------------------
   ORDER CRUD ROUTES  (all protected)
--------------------------------------------- */

// CREATE — new order
app.post("/api/orders", requireAuth, async (req, res) => {
  try {
    const { customerName, item, size, quantity, notes, price } = req.body;

    if (!customerName || !item || price === undefined) {
      return res.status(400).json({ message: "Customer name, item, and price are required." });
    }

    const order = await Order.create({
      customerName,
      item,
      size,
      quantity,
      notes,
      price,
      createdBy: req.user.userId
    });

    res.status(201).json({ message: "Order created.", order });
  } catch (error) {
    res.status(500).json({ message: "Server error." });
  }
});

// READ — list all orders (optional ?status= filter)
app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders });
  } catch (error) {
    res.status(500).json({ message: "Server error." });
  }
});

// READ — single order
app.get("/api/orders/:id", requireAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found." });
    res.json({ order });
  } catch (error) {
    res.status(400).json({ message: "Invalid order id." });
  }
});

// UPDATE — edit order details or status
app.put("/api/orders/:id", requireAuth, async (req, res) => {
  try {
    const { customerName, item, size, quantity, notes, price, status } = req.body;

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { customerName, item, size, quantity, notes, price, status },
      { new: true, runValidators: true, omitUndefined: true }
    );

    if (!order) return res.status(404).json({ message: "Order not found." });

    res.json({ message: "Order updated.", order });
  } catch (error) {
    res.status(400).json({ message: "Could not update order." });
  }
});

// DELETE — remove order
app.delete("/api/orders/:id", requireAuth, async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found." });
    res.json({ message: "Order deleted." });
  } catch (error) {
    res.status(400).json({ message: "Invalid order id." });
  }
});

/* ---------------------------------------------
   START SERVER
--------------------------------------------- */

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected.");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error);
  });