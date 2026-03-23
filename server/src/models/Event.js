const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ticketPrice: { type: Number, required: true, min: 0 },
    attendees: {
      type: [
        new mongoose.Schema(
          {
            id: { type: String, required: true, trim: true },
            name: { type: String, required: true, trim: true },
            email: { type: String, trim: true, lowercase: true, default: null },
            customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
            invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

eventSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Event", eventSchema);
