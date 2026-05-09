const mongoose = require("mongoose");

async function connectDb() {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("❌ Missing MONGODB_URI in environment variables.");
    }

    mongoose.set("strictQuery", true);

    // Connect to MongoDB
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });

    console.log("✅ MongoDB Connected Successfully");
  } catch (error) {
    console.error("❌ MongoDB Connection Failed:");
    console.error(error.message);
    process.exit(1); // Stop the server immediately if DB fails
  }
}

module.exports = { connectDb };