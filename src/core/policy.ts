/**
 * Loads `policies/<id>/`: policy.json (required), reference.json and folk.json (optional).
 * The holdout file is deliberately not loadable from here: it is scorer-only (src/eval).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { FolkFile, PolicyPackage, Reference, type PolicyVersion, type Surface } from "../shared/schema";
import { splitSurfaces } from "../shared/sentences";
import { POLICIES_DIR } from "./paths";

function readJson<S extends z.ZodType>(file: string, schema: S): z.infer<S> {
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (err) {
    throw new Error(`${file}: ${(err as Error).message}`);
  }
}

export function listPolicyIds(dir = POLICIES_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => existsSync(path.join(dir, name, "policy.json")));
}

export function loadPolicyPackage(policyId: string, dir = POLICIES_DIR): PolicyPackage {
  const pkg = readJson(path.join(dir, policyId, "policy.json"), PolicyPackage);
  if (pkg.id !== policyId) throw new Error(`policies/${policyId}/policy.json has id "${pkg.id}"`);
  return pkg;
}

/** null when the policy has no reference yet (runs are then ungraded). */
export function loadReference(policyId: string, dir = POLICIES_DIR): Reference | null {
  const file = path.join(dir, policyId, "reference.json");
  return existsSync(file) ? readJson(file, Reference) : null;
}

export function loadFolk(policyId: string, dir = POLICIES_DIR): FolkFile {
  const file = path.join(dir, policyId, "folk.json");
  return existsSync(file) ? readJson(file, FolkFile) : { policyId, versions: [] };
}

export function makeVersion(policyId: string, version: number, parentVersion: number | null, surfaces: Surface[]): PolicyVersion {
  return { policyId, version, parentVersion, surfaces, sentences: splitSurfaces(surfaces) };
}

/** Version 0: the package exactly as published. */
export function versionZero(pkg: PolicyPackage): PolicyVersion {
  return makeVersion(pkg.id, 0, null, pkg.surfaces);
}
