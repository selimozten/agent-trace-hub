import fs from "node:fs";
import path from "node:path";
import type { JsonValue } from "./types.ts";
import { isRecord } from "./workspace.ts";

type SchemaValue = JsonValue;
type SchemaObject = { [key: string]: SchemaValue };

export function validateJsonSchema(value: JsonValue, schemaPath: string): void {
  const rootPath = path.resolve(schemaPath);
  const rootSchema = readSchema(rootPath);
  validateValue(value, rootSchema, "$", rootSchema, path.dirname(rootPath));
}

function validateValue(value: JsonValue, schema: SchemaObject, jsonPath: string, rootSchema: SchemaObject, schemaDir: string): void {
  if (typeof schema.$ref === "string") {
    return validateValue(value, resolveRef(schema.$ref, rootSchema, schemaDir), jsonPath, rootSchema, schemaDir);
  }

  if (Array.isArray(schema.oneOf)) {
    let passes = 0;
    const errors: string[] = [];
    for (const option of schema.oneOf) {
      if (!isRecord(option)) continue;
      try {
        validateValue(value, option as SchemaObject, jsonPath, rootSchema, schemaDir);
        passes++;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (passes !== 1) {
      throw new Error(`${jsonPath} expected exactly one matching schema, got ${passes}${errors.length > 0 ? ` (${errors[0]})` : ""}`);
    }
    return;
  }

  if ("const" in schema && value !== schema.const) throw new Error(`${jsonPath} expected const ${String(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) throw new Error(`${jsonPath} expected one of ${schema.enum.map(String).join(", ")}`);
  if (typeof schema.type === "string") validateType(value, schema.type, jsonPath);
  if (typeof schema.minLength === "number" && typeof value === "string" && value.length < schema.minLength) {
    throw new Error(`${jsonPath} below minLength ${schema.minLength}`);
  }
  if (typeof schema.minimum === "number" && typeof value === "number" && value < schema.minimum) {
    throw new Error(`${jsonPath} below minimum ${schema.minimum}`);
  }
  if (typeof schema.pattern === "string" && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    throw new Error(`${jsonPath} does not match pattern`);
  }

  if (schema.type === "array" && Array.isArray(value) && isRecord(schema.items)) {
    for (const [index, item] of value.entries()) validateValue(item, schema.items as SchemaObject, `${jsonPath}[${index}]`, rootSchema, schemaDir);
  }

  if (schema.type === "object" && isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === "string" && !Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${jsonPath} missing ${key}`);
    }

    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`${jsonPath}.${key} is not allowed`);
      }
    }

    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && isRecord(childSchema)) {
        validateValue(value[key], childSchema as SchemaObject, `${jsonPath}.${key}`, rootSchema, schemaDir);
      }
    }

    if (isRecord(schema.additionalProperties)) {
      for (const [key, child] of Object.entries(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          validateValue(child, schema.additionalProperties as SchemaObject, `${jsonPath}.${key}`, rootSchema, schemaDir);
        }
      }
    }
  }
}

function validateType(value: JsonValue, type: string, jsonPath: string): void {
  if (type === "object") {
    if (!isRecord(value)) throw new Error(`${jsonPath} expected object`);
    return;
  }
  if (type === "array") {
    if (!Array.isArray(value)) throw new Error(`${jsonPath} expected array`);
    return;
  }
  if (type === "integer") {
    if (!Number.isInteger(value)) throw new Error(`${jsonPath} expected integer`);
    return;
  }
  if (typeof value !== type) throw new Error(`${jsonPath} expected ${type}`);
}

function resolveRef(ref: string, rootSchema: SchemaObject, schemaDir: string): SchemaObject {
  if (ref.startsWith("#/$defs/")) {
    const defs = isRecord(rootSchema.$defs) ? rootSchema.$defs : {};
    const found = defs[ref.slice("#/$defs/".length)];
    if (!isRecord(found)) throw new Error(`Unresolved schema ref: ${ref}`);
    return found as SchemaObject;
  }

  const [file, fragment] = ref.split("#");
  const external = readSchema(path.join(schemaDir, file));
  if (!fragment) return external;
  if (fragment.startsWith("/$defs/")) {
    const defs = isRecord(external.$defs) ? external.$defs : {};
    const found = defs[fragment.slice("/$defs/".length)];
    if (!isRecord(found)) throw new Error(`Unresolved schema ref: ${ref}`);
    return found as SchemaObject;
  }
  throw new Error(`Unsupported schema ref: ${ref}`);
}

function readSchema(schemaPath: string): SchemaObject {
  const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf-8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Invalid schema: ${schemaPath}`);
  return parsed as SchemaObject;
}
