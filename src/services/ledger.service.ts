import ledgerModel from "../models/LedgerModel.ts";
import AccountModel from "../models/AccountModel.ts";
import mongoose from "mongoose";

export interface LedgerAuditResult {
    accountId: string;
    accountNumber: string;
    materializedBalance: number;
    derivedBalance: number;
    isConsistent: boolean;
    difference: number;
}

/**
 * Calculates the exact balance derived from immutable ledger entries.
 * Derived Balance = Sum(CREDIT entries) - Sum(DEBIT entries)
 */
export async function calculateLedgerBalance(
    accountId: mongoose.Types.ObjectId | string
): Promise<number> {
    const objId = new mongoose.Types.ObjectId(accountId);

    const result = await ledgerModel.aggregate([
        { $match: { account: objId } },
        {
            $group: {
                _id: "$account",
                totalCredit: {
                    $sum: {
                        $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", 0]
                    }
                },
                totalDebit: {
                    $sum: {
                        $cond: [{ $eq: ["$type", "DEBIT"] }, "$amount", 0]
                    }
                }
            }
        },
        {
            $project: {
                balance: { $subtract: ["$totalCredit", "$totalDebit"] }
            }
        }
    ]);

    if (result.length === 0) {
        return 0;
    }

    return result[0].balance;
}

/**
 * Verifies that the materialized Account.balance matches the immutable double-entry ledger total.
 */
export async function verifyAccountBalance(
    accountId: mongoose.Types.ObjectId | string
): Promise<LedgerAuditResult> {
    const account = await AccountModel.findById(accountId);
    if (!account) {
        throw new Error(`Account not found: ${accountId}`);
    }

    const derivedBalance = await calculateLedgerBalance(account._id);
    const materializedBalance = account.balance;
    const difference = Math.abs(materializedBalance - derivedBalance);
    const isConsistent = difference < 0.0001;

    if (!isConsistent) {
        console.error("[CRITICAL LEDGER MISMATCH AUDIT ALERT]", {
            severity: "HIGH",
            accountId: account._id.toString(),
            accountNumber: account.accountNumber,
            materializedBalance,
            derivedBalance,
            difference,
            timestamp: new Date().toISOString()
        });
    }

    return {
        accountId: account._id.toString(),
        accountNumber: account.accountNumber,
        materializedBalance,
        derivedBalance,
        isConsistent,
        difference
    };
}
