const crypto = require("crypto");
const idempotencyKeyModel = require("../models/idempotencykey.model");

function hashBody(body) {
    return crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

async function idempotencyMiddleware(req, res, next) {
    const key = req.headers["idempotency-key"];

    if (!key) {
        return res.status(400).json({
            message: "Idempotency-Key header is required for this operation"
        });
    }

    const requestHash = hashBody(req.body);

    try {
        // atomic: create only if key doesn't exist yet
        const existing = await idempotencyKeyModel.findOneAndUpdate(
            { key },
            {
                $setOnInsert: {
                    key,
                    user: req.user._id,
                    requestHash,
                    status: "processing"
                }
            },
            { upsert: true, new: false } // new:false -> returns null if this insert just happened
        );

        if (existing) {
            // key already seen before
            if (existing.requestHash !== requestHash) {
                return res.status(409).json({
                    message: "Idempotency-Key reused with a different request payload"
                });
            }

            if (existing.status === "processing") {
                return res.status(409).json({
                    message: "A request with this Idempotency-Key is still being processed"
                });
            }

            // already completed -> replay the original response, don't touch the ledger again
            return res.status(existing.responseStatusCode).json(existing.responseBody);
        }

        // first time seeing this key -> capture the response once the controller sends it
        const originalJson = res.json.bind(res);
        res.json = async (body) => {
            await idempotencyKeyModel.updateOne(
                { key },
                {
                    status: "completed",
                    responseStatusCode: res.statusCode,
                    responseBody: body
                }
            );
            return originalJson(body);
        };

        next();
    } catch (err) {
        return res.status(500).json({ message: "Idempotency check failed", error: err.message });
    }
}

module.exports = idempotencyMiddleware;