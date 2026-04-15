import path from "node:path";

import { executePrivilegedAction } from "../core/privileged-execution.js";

function parseExecuteOptions(args: string[]): {
  requestPath?: string;
  capabilityProfilePath?: string;
  approvalReceiptPath?: string;
  receiptDir?: string;
} {
  const positional: string[] = [];
  const options: {
    capabilityProfilePath?: string;
    approvalReceiptPath?: string;
    receiptDir?: string;
  } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--capability-profile") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --capability-profile.");
      }
      options.capabilityProfilePath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--approval-receipt") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --approval-receipt.");
      }
      options.approvalReceiptPath = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--receipt-dir") {
      const nextArg = args[index + 1];
      if (!nextArg) {
        throw new Error("Missing value for --receipt-dir.");
      }
      options.receiptDir = nextArg;
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  const parsed: {
    requestPath?: string;
    capabilityProfilePath?: string;
    approvalReceiptPath?: string;
    receiptDir?: string;
  } = { ...options };

  if (positional[0]) {
    parsed.requestPath = positional[0];
  }

  return parsed;
}

function normalizeOutputPath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, "/");
}

export async function runExecuteCommand(args: string[]): Promise<number> {
  try {
    const parsed = parseExecuteOptions(args);
    if (!parsed.requestPath) {
      console.error(
        "Usage: lifeline execute <request-path> --capability-profile <path> --approval-receipt <path> [--receipt-dir <path>]",
      );
      return 1;
    }

    if (!parsed.capabilityProfilePath) {
      console.error("Missing --capability-profile path.");
      return 1;
    }

    if (!parsed.approvalReceiptPath) {
      console.error("Missing --approval-receipt path.");
      return 1;
    }

    const result = await executePrivilegedAction({
      requestPath: parsed.requestPath,
      capabilityProfilePath: parsed.capabilityProfilePath,
      approvalReceiptPath: parsed.approvalReceiptPath,
      ...(parsed.receiptDir ? { receiptDir: parsed.receiptDir } : {}),
    });

    console.log(JSON.stringify(result.receipt, null, 2));
    console.log(`Receipt written: ${normalizeOutputPath(result.receiptPath)}`);
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }
}
