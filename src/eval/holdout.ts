/**
 * The ONLY reader of `policies/<id>/holdout.json`. Nothing outside src/eval may import
 * this module or read that file: `npm run guard` fails the check if anything does.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Holdout } from "../shared/schema";
import { POLICIES_DIR } from "../core/paths";

export function loadHoldout(policyId: string, dir = POLICIES_DIR): Holdout | null {
  const file = path.join(dir, policyId, "holdout.json");
  if (!existsSync(file)) return null;
  return Holdout.parse(JSON.parse(readFileSync(file, "utf8")));
}
