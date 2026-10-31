/**
 * zod → JSON Schema accepted by OpenAI strict structured outputs (Responses
 * `text.format`, App Server `outputSchema`, function/dynamic tool parameters).
 *
 * Rules enforced (throw = developer error, fix the schema):
 * - every object property is required (use `.nullable()`, never `.optional()`)
 * - no open records (`z.record`, `z.looseObject`): use arrays of {key, value}
 * Keywords strict mode rejects are stripped; zod re-validates the parsed output anyway.
 */
import { z } from "zod";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const STRIPPED_KEYWORDS = ["$schema", "minLength", "maxLength", "default", "examples", "title"] as const;

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalise(node: Json, at: string): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => normalise(child, `${at}[${i}]`));
    return;
  }
  if (!isObject(node)) return;

  for (const keyword of STRIPPED_KEYWORDS) delete node[keyword];

  if (node.oneOf !== undefined) {
    node.anyOf = node.oneOf;
    delete node.oneOf;
  }

  if (node.type === "object") {
    const properties = isObject(node.properties) ? node.properties : {};
    const keys = Object.keys(properties);
    const required = Array.isArray(node.required) ? node.required : [];
    const optional = keys.filter((key) => !required.includes(key));
    if (optional.length > 0) {
      throw new Error(`${at}: optional properties are not allowed in LLM schemas (${optional.join(", ")}); use .nullable()`);
    }
    if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
      throw new Error(`${at}: open records are not allowed in LLM schemas; use an array of {key, value}`);
    }
    node.properties = properties;
    node.required = keys;
    node.additionalProperties = false;
  }

  for (const [key, child] of Object.entries(node)) {
    if (key === "required" || key === "enum" || key === "const") continue;
    if (key === "properties" && isObject(child)) {
      for (const [prop, schema] of Object.entries(child)) normalise(schema, `${at}.${prop}`);
      continue;
    }
    normalise(child, `${at}/${key}`);
  }
}

export function llmJsonSchema(schema: z.ZodType): JsonObject {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "throw" }) as JsonObject;
  normalise(json, "$");
  return json;
}
