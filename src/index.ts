#!/usr/bin/env node --experimental-strip-types --no-warnings=ExperimentalWarning

import { parseApproveArgs, parseAuditArgs, parseCollectArgs, parseDiscoverArgs, parseEnrichArgs, parseGrepArgs, parseIngestArgs, parseInitArgs, parseListArgs, parseNormalizeArgs, parseNormalizeDirArgs, parseRejectArgs, parseReleaseArgs, parseRenderArgs, parseReviewArgs, parseReviewGateArgs, parseUploadArgs, parseValidateArtifactArgs, parseValidateArgs, printUsage } from "./cli.ts";
import { runApprove } from "./approve.ts";
import { runAudit } from "./audit.ts";
import { runCollect, runInit } from "./collect.ts";
import { runDiscover } from "./discover.ts";
import { runEnrich } from "./enrich.ts";
import { runIngest } from "./ingest.ts";
import { runNormalize, runNormalizeDir } from "./normalize.ts";
import { runRelease } from "./release.ts";
import { runRender } from "./render.ts";
import { runReviewGate } from "./review-gate.ts";
import { ensureStartupTools } from "./process.ts";
import { runReject } from "./reject.ts";
import { runReview } from "./review.ts";
import { runUpload } from "./upload.ts";
import { runGrep, runList } from "./query.ts";
import { runValidateArtifact } from "./validate-artifact.ts";
import { runValidate } from "./validate.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  await ensureStartupTools(command);

  if (command === "init") {
    await runInit(parseInitArgs(args.slice(1)));
    return;
  }

  if (command === "collect") {
    await runCollect(parseCollectArgs(args.slice(1)));
    return;
  }

  if (command === "review") {
    await runReview(parseReviewArgs(args.slice(1)));
    return;
  }

  if (command === "upload") {
    await runUpload(parseUploadArgs(args.slice(1)));
    return;
  }

  if (command === "reject") {
    await runReject(parseRejectArgs(args.slice(1)));
    return;
  }

  if (command === "list") {
    await runList(parseListArgs(args.slice(1)));
    return;
  }

  if (command === "grep") {
    await runGrep(parseGrepArgs(args.slice(1)));
    return;
  }

  if (command === "discover") {
    await runDiscover(parseDiscoverArgs(args.slice(1)));
    return;
  }

  if (command === "ingest") {
    await runIngest(parseIngestArgs(args.slice(1)));
    return;
  }

  if (command === "normalize") {
    await runNormalize(parseNormalizeArgs(args.slice(1)));
    return;
  }

  if (command === "normalize-dir") {
    await runNormalizeDir(parseNormalizeDirArgs(args.slice(1)));
    return;
  }

  if (command === "validate") {
    await runValidate(parseValidateArgs(args.slice(1)));
    return;
  }

  if (command === "validate-artifact") {
    await runValidateArtifact(parseValidateArtifactArgs(args.slice(1)));
    return;
  }

  if (command === "audit") {
    await runAudit(parseAuditArgs(args.slice(1)));
    return;
  }

  if (command === "approve") {
    await runApprove(parseApproveArgs(args.slice(1)));
    return;
  }

  if (command === "review-gate") {
    await runReviewGate(parseReviewGateArgs(args.slice(1)));
    return;
  }

  if (command === "render") {
    await runRender(parseRenderArgs(args.slice(1)));
    return;
  }

  if (command === "enrich") {
    await runEnrich(parseEnrichArgs(args.slice(1)));
    return;
  }

  if (command === "release") {
    await runRelease(parseReleaseArgs(args.slice(1)));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
