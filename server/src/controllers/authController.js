const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");
const { logAction, buildMetadata, ACTIONS } = require("../utils/audit");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function signToken(userId, role) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET in environment");
  return jwt.sign(
    { sub: userId, role: role || "receptionist" },
    secret,
    { expiresIn: "7d" },
  );
}

async function register(req, res) {
  try {
    const { name, email, password } = req.body ?? {};

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email, password required" });
    }
    if (typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ message: "name must be at least 2 characters" });
    }
    if (typeof email !== "string" || !isValidEmail(email)) {
      return res.status(400).json({ message: "invalid email" });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "password must be at least 6 characters" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await User.findOne({ email: normalizedEmail }).lean();
    if (existing) {
      return res.status(409).json({ message: "email already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashed,
      role: "user",
    });

    return res.status(201).json({ message: "registered successfully" });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "AUTH_REGISTER_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ message: "email and password required" });
    }
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ message: "invalid input" });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail }).select("+password");
    if (!user) {
      return res.status(401).json({ message: "invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "invalid credentials" });
    }

    const role = user.role || "receptionist";
    const token = signToken(user._id.toString(), role);

    await logAction(user._id, ACTIONS.LOGIN, "auth", user._id, buildMetadata(null, {
      userId: user._id.toString(),
      email:  user.email,
    }));

    return res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "AUTH_LOGIN_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = { register, login };

