import path from "node:path";

import { ValidationError } from "../core/errors.js";
import {
  formatOperatorFailureSurface,
  type OperatorFailureSurface,
} from "../core/receipt-store.js";
import { emitUiProofPassedReceipt } from "../core/ui-proof-receipt.js";

function parseProofPassOptions(args: string[]): {
  proofSummaryPath?: string;
  sourceRepoId?: string;
  trancheId?: string;
  receiptDir?: string;
} {
  const positional: string[] = [];
  const options: {
    sourceRepoId?: string;
    trancheId?: string;
    receiptDir?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--source-repo") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new ValidationError("Missing value for --source-repo.");
      }
      options.sourceRepoId = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--tranche") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new ValidationError("Missing value for --tranche.");
      }
      options.trancheId = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--receipt-dir") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new ValidationError("Missing value for --receipt-dir.");
      }
      options.receiptDir = nextArg;
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  return {
    ...(positional[0] ? { proofSummaryPath: positional[0] } : {}),
    ...options,
  };
}

function normalizeOutputPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, "/");
}

function categorizeProofPassError(error: unknown): OperatorFailureSurface {
  if (error instanceof ValidationError) {
    const message = error.message.toLowerCase();
    if (
      message.includes("could not read json file") ||
      message.includes("could not resolve relative proof report ref") ||
      message.includes("is not readable")
    ) {
      return {
        category: "environment_error",
        first_remediation_step:
          "Verify the proof summary path and the referenced proof reports are readable, then rerun.",
      };
    }

    return {
      category: "config_error",
      first_remediation_step:
        "Fix the proof summary, source repo, or tranche arguments so they match the ATLAS proof contract, then rerun.",
    };
  }

  return {
    category: "runtime_error",
    first_remediation_step:
      "Inspect the local runtime error, fix the underlying issue, and rerun.",
  };
}

export async function runProofPassCommand(args: string[]): Promise<number> {
  try {
    const parsed = parseProofPassOptions(args);
    if (!parsed.proofSummaryPath) {
      console.error(
        "Usage: lifeline proof-pass <proof-summary-path> --source-repo <id> --tranche <id> [--receipt-dir <path>]",
      );
      return 1;
    }
    if (!parsed.sourceRepoId) {
      console.error("Missing --source-repo value.");
      return 1;
    }
    if (!parsed.trancheId) {
      console.error("Missing --tranche value.");
      return 1;
    }

    const result = await emitUiProofPassedReceipt({
      proofSummaryPath: parsed.proofSummaryPath,
      sourceRepoId: parsed.sourceRepoId,
      trancheId: parsed.trancheId,
      ...(parsed.receiptDir ? { receiptDir: parsed.receiptDir } : {}),
    });

    console.log(JSON.stringify(result.receipt, null, 2));
    console.log(`Receipt written: ${normalizeOutputPath(result.receiptPath)}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      formatOperatorFailureSurface(categorizeProofPassError(error), message),
    );
    return 1;
  }
}
