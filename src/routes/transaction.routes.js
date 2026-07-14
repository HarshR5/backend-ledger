const { Router } = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const transactionController = require("../controllers/transaction.controller");
const idempotencyMiddleware = require("../middleware/idempotency.middleware");

const transactionRoutes = Router();

/**
 * POST /api/transactions/
 * Create a new transaction between two accounts.
 * Requires: Authorization header (JWT) + Idempotency-Key header
 */
transactionRoutes.post(
    "/",
    authMiddleware.authMiddleware,
    idempotencyMiddleware,
    transactionController.createTransaction
);

/**
 * POST /api/transactions/system/initial-funds
 * Create initial funds transaction from the system user.
 * Requires: Authorization header (system JWT) + Idempotency-Key header
 */
transactionRoutes.post(
    "/system/initial-funds",
    authMiddleware.authSystemUserMiddleware,
    idempotencyMiddleware,
    transactionController.createInitialFundsTransaction
);

module.exports = transactionRoutes;