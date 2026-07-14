const mongoose = require("mongoose");

const idempotencyKeySchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    requestHash: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ["processing", "completed"],
        default: "processing"
    },
    responseStatusCode: Number,
    responseBody: mongoose.Schema.Types.Mixed
}, { timestamps: true });

// auto-expire old keys after 24 hours so collection doesn't grow forever
idempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("IdempotencyKey", idempotencyKeySchema);