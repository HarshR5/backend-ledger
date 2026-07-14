const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const accountModel = require("../models/account.model")
const emailService = require("../services/email.service")
const mongoose = require("mongoose")

/**
 * - Create a new transaction
 * THE 9-STEP TRANSFER FLOW:
     * 1. Validate request
     * 2. Check account status          (idempotency is handled by middleware)
     * 3. Derive sender balance from ledger
     * 4. Create transaction (PENDING)
     * 5. Create DEBIT ledger entry
     * 6. Create CREDIT ledger entry
     * 7. Mark transaction COMPLETED
     * 8. Commit MongoDB session
     * 9. Send email notification
 */

async function createTransaction(req, res) {

    /**
     * 1. Validate request
     * Note: idempotency is enforced by idempotencyMiddleware before this runs.
     */
    const { fromAccount, toAccount, amount } = req.body

    if (!fromAccount || !toAccount || !amount) {
        return res.status(400).json({
            message: "fromAccount, toAccount and amount are required"
        })
    }

    const fromUserAccount = await accountModel.findOne({ _id: fromAccount })
    const toUserAccount = await accountModel.findOne({ _id: toAccount })

    if (!fromUserAccount || !toUserAccount) {
        return res.status(400).json({
            message: "Invalid fromAccount or toAccount"
        })
    }

    /**
     * 2. Check account status
     */

    if (fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE") {
        return res.status(400).json({
            message: "Both fromAccount and toAccount must be ACTIVE to process transaction"
        })
    }

    /**
     * 3. Derive sender balance from ledger
     */
    const balance = await fromUserAccount.getBalance()

    if (balance < amount) {
        return res.status(400).json({
            message: `Insufficient balance. Current balance is ${balance}. Requested amount is ${amount}`
        })
    }

    let transaction;
    let session;
    try {

        /**
         * 4. Create transaction (PENDING)
         */
        session = await mongoose.startSession()
        session.startTransaction()

        // idempotencyKey is kept on the Transaction as an audit trail
        const idempotencyKey = req.headers["idempotency-key"]

        transaction = (await transactionModel.create([ {
            fromAccount,
            toAccount,
            amount,
            idempotencyKey,
            status: "PENDING"
        } ], { session }))[ 0 ]

        const debitLedgerEntry = await ledgerModel.create([ {
            account: fromAccount,
            amount: amount,
            transaction: transaction._id,
            type: "DEBIT"
        } ], { session })

        const creditLedgerEntry = await ledgerModel.create([ {
            account: toAccount,
            amount: amount,
            transaction: transaction._id,
            type: "CREDIT"
        } ], { session })

        await transactionModel.findOneAndUpdate(
            { _id: transaction._id },
            { status: "COMPLETED" },
            { session }
        )

        await session.commitTransaction()
        session.endSession()
    } catch (error) {
        if (session) {
            await session.abortTransaction()
            session.endSession()
        }
        return res.status(400).json({
            message: "Transaction is Pending due to some issue, please retry after sometime",
        })
    }
    /**
     * 9. Send email notification
     */
    await emailService.sendTransactionEmail(req.user.email, req.user.name, amount, toAccount)

    return res.status(201).json({
        message: "Transaction completed successfully",
        transaction: transaction
    })

}

async function createInitialFundsTransaction(req, res) {
    const { toAccount, amount } = req.body

    if (!toAccount || !amount) {
        return res.status(400).json({
            message: "toAccount and amount are required"
        })
    }

    const toUserAccount = await accountModel.findOne({ _id: toAccount })

    if (!toUserAccount) {
        return res.status(400).json({
            message: "Invalid toAccount"
        })
    }

    const fromUserAccount = await accountModel.findOne({ user: req.user._id })

    if (!fromUserAccount) {
        return res.status(400).json({
            message: "System user account not found"
        })
    }

    // idempotencyKey kept on the Transaction as an audit trail
    const idempotencyKey = req.headers["idempotency-key"]

    let transaction;
    let session;
    try {
        session = await mongoose.startSession()
        session.startTransaction()

        transaction = new transactionModel({
            fromAccount: fromUserAccount._id,
            toAccount,
            amount,
            idempotencyKey,
            status: "PENDING"
        })

        await ledgerModel.create([ {
            account: fromUserAccount._id,
            amount: amount,
            transaction: transaction._id,
            type: "DEBIT"
        } ], { session })

        await ledgerModel.create([ {
            account: toAccount,
            amount: amount,
            transaction: transaction._id,
            type: "CREDIT"
        } ], { session })

        transaction.status = "COMPLETED"
        await transaction.save({ session })

        await session.commitTransaction()
        session.endSession()
    } catch (error) {
        if (session) {
            await session.abortTransaction()
            session.endSession()
        }
        return res.status(500).json({
            message: "Initial funds transaction failed, please retry",
        })
    }

    return res.status(201).json({
        message: "Initial funds transaction completed successfully",
        transaction: transaction
    })
}

module.exports = {
    createTransaction,
    createInitialFundsTransaction
}

