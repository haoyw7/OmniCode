import { z } from "zod";
// 已保存工作流的实参表单与元数据实参表。
// 纯函数：把 frontmatter 的 args 声明铺成可编辑字段，再把字段收回成实参袋 / 声明；
// 校验规则与 CLI 的 validateWorkflowArgs 同源（required、按类型解析、default 回填由服务端做）。
import type { OmniCodeSavedWorkflowArgType, OmniCodeSavedWorkflowArgsDeclaration } from "../../_shims/shared.js";

export interface SavedWorkflowArgField {
  name: string;
  type: OmniCodeSavedWorkflowArgType;
  description?: string;
  required: boolean;
  hasDefault: boolean;
  /** 编辑器里的文本；boolean 用 "true" / "false"。 */
  value: string;
}

export type SavedWorkflowArgFieldError = "required" | "invalid_number" | "invalid_json";

/** 把一个默认值 / 已有值按类型转成编辑器文本。 */
function formatSavedWorkflowArgValue(type: OmniCodeSavedWorkflowArgType, value: unknown): string {
  if (value === undefined) return type === "boolean" ? "false" : "";
  switch (type) {
    case "string":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "number":
      return typeof value === "number" ? String(value) : String(value);
    case "boolean":
      return value === true ? "true" : "false";
    case "json":
      return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  }
}

export function buildSavedWorkflowArgFields(
  declaration: OmniCodeSavedWorkflowArgsDeclaration | undefined,
): SavedWorkflowArgField[] {
  if (!declaration) return [];
  return Object.entries(declaration).map(([name, spec]) => ({
    name,
    type: spec.type,
    ...(spec.description === undefined ? {} : { description: spec.description }),
    required: spec.required === true,
    hasDefault: spec.default !== undefined,
    value: formatSavedWorkflowArgValue(spec.type, spec.default),
  }));
}

/** Shared parsing and validation for submitted workflow arguments. */
export const savedWorkflowArgsSchema = z.array(z.custom<SavedWorkflowArgField>()).transform((fields, ctx) => {
  const args: Record<string, unknown> = {};
  for (const [index, field] of fields.entries()) {
    const raw = field.value;
    const issue = (message: SavedWorkflowArgFieldError) => ctx.addIssue({ code: "custom", path: [index, "value"], message });
    if (field.type === "boolean") { args[field.name] = raw === "true"; continue; }
    if (!raw.trim()) {
      if (field.required && !field.hasDefault) issue("required");
      continue;
    }
    if (field.type === "string") args[field.name] = raw;
    else if (field.type === "number") {
      const value = Number(raw.trim());
      if (!Number.isFinite(value)) issue("invalid_number");
      else args[field.name] = value;
    } else {
      try { args[field.name] = JSON.parse(raw) as unknown; }
      catch { issue("invalid_json"); }
    }
  }
  return args;
});

type SavedWorkflowArgsCollect =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; errors: Record<string, SavedWorkflowArgFieldError> };

export function collectSavedWorkflowArgs(fields: readonly SavedWorkflowArgField[]): SavedWorkflowArgsCollect {
  const result = savedWorkflowArgsSchema.safeParse(fields);
  if (result.success) return { ok: true, args: result.data };
  const errors: Record<string, SavedWorkflowArgFieldError> = {};
  for (const issue of result.error.issues) {
    const field = fields[Number(issue.path[0])];
    if (field) errors[field.name] = issue.message as SavedWorkflowArgFieldError;
  }
  return { ok: false, errors };
}

// ── 元数据编辑：实参声明表 ──

export interface SavedWorkflowArgRow {
  /** 行的稳定身份（新增行也要有，名字可空）。 */
  key: string;
  name: string;
  type: OmniCodeSavedWorkflowArgType;
  required: boolean;
  /** 默认值的编辑文本；空即无默认值（boolean 用 "" / "true" / "false"）。 */
  defaultText: string;
  description: string;
}

export type SavedWorkflowArgRowError = "empty_name" | "duplicate_name" | "invalid_default";

export function argsDeclarationToRows(
  declaration: OmniCodeSavedWorkflowArgsDeclaration | undefined,
): SavedWorkflowArgRow[] {
  if (!declaration) return [];
  return Object.entries(declaration).map(([name, spec], index) => ({
    key: `${index}:${name}`,
    name,
    type: spec.type,
    required: spec.required === true,
    defaultText:
      spec.default === undefined
        ? ""
        : spec.type === "boolean"
          ? spec.default === true
            ? "true"
            : "false"
          : formatSavedWorkflowArgValue(spec.type, spec.default),
    description: spec.description ?? "",
  }));
}

function parseDefaultText(
  type: OmniCodeSavedWorkflowArgType,
  text: string,
): { ok: true; value?: unknown } | { ok: false } {
  if (text.trim().length === 0) return { ok: true };
  switch (type) {
    case "string":
      return { ok: true, value: text };
    case "number": {
      const parsed = Number(text.trim());
      return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
    }
    case "boolean":
      if (text === "true") return { ok: true, value: true };
      if (text === "false") return { ok: true, value: false };
      return { ok: false };
    case "json":
      try {
        return { ok: true, value: JSON.parse(text) as unknown };
      } catch {
        return { ok: false };
      }
  }
}

type SavedWorkflowArgRowsCollect =
  | { ok: true; args: OmniCodeSavedWorkflowArgsDeclaration | undefined }
  | { ok: false; errors: Record<string, SavedWorkflowArgRowError> };

/**
 * 实参表 → 声明。名字只要求非空且唯一（声明本就是 record，`args.x` 的读法不限定标识符）；
 * 空表回 undefined（frontmatter 里就没有 args 键，而不是 `args: {}`）。
 */
export function rowsToArgsDeclaration(
  rows: readonly SavedWorkflowArgRow[],
): SavedWorkflowArgRowsCollect {
  const errors: Record<string, SavedWorkflowArgRowError> = {};
  const seen = new Set<string>();
  const args: OmniCodeSavedWorkflowArgsDeclaration = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name.length === 0) {
      errors[row.key] = "empty_name";
      continue;
    }
    if (seen.has(name)) {
      errors[row.key] = "duplicate_name";
      continue;
    }
    seen.add(name);
    const parsedDefault = parseDefaultText(row.type, row.defaultText);
    if (!parsedDefault.ok) {
      errors[row.key] = "invalid_default";
      continue;
    }
    const description = row.description.trim();
    args[name] = {
      type: row.type,
      ...(description.length === 0 ? {} : { description }),
      ...(row.required ? { required: true } : {}),
      ...(parsedDefault.value === undefined ? {} : { default: parsedDefault.value }),
    };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, args: Object.keys(args).length === 0 ? undefined : args };
}
