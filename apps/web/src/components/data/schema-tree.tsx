import type { JsonSchema } from "@/lib/api/openapi";

function typeLabel(schema: JsonSchema): string {
  if (schema.const !== undefined) return `"${String(schema.const)}"`;
  if (Array.isArray(schema.enum))
    return (schema.enum as unknown[]).map((v) => `"${String(v)}"`).join(" | ");
  const anyOf = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
  if (anyOf) {
    const parts = anyOf.map((s) => typeLabel(s));
    return [...new Set(parts)].join(" | ");
  }
  const type = schema.type;
  if (Array.isArray(type)) return type.join(" | ");
  if (type === "array") {
    const items = schema.items as JsonSchema | undefined;
    if (schema.prefixItems) {
      return `[${(schema.prefixItems as JsonSchema[]).map((s) => typeLabel(s)).join(", ")}]`;
    }
    return items ? `${typeLabel(items)}[]` : "array";
  }
  if (type === "string" && typeof schema.format === "string") return `string (${schema.format})`;
  if (type === undefined && schema.properties) return "object";
  return typeof type === "string" ? type : "any";
}

function childObject(schema: JsonSchema): JsonSchema | null {
  if (schema.properties) return schema;
  const anyOf = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
  const obj = anyOf?.find((s) => s.properties);
  if (obj) return obj;
  if (schema.type === "array") {
    const items = schema.items as JsonSchema | undefined;
    if (items) return childObject(items);
  }
  const additional = schema.additionalProperties as JsonSchema | boolean | undefined;
  if (additional && typeof additional === "object") return childObject(additional);
  return null;
}

/**
 * Дерево JSON Schema (из Zod) для документации API: имя поля, тип, обязательность и описание.
 * Вложенные объекты — <details>, чтобы длинные ответы читались, и всё работало без JS.
 */
export function SchemaTree({
  schema,
  depth = 0,
  requiredLabel,
}: {
  schema: JsonSchema;
  depth?: number;
  requiredLabel: string;
}) {
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const entries = Object.entries(props);
  if (entries.length === 0) {
    const additional = schema.additionalProperties as JsonSchema | undefined;
    if (additional && typeof additional === "object") {
      const child = childObject(additional);
      return (
        <p className="text-xs text-muted-foreground">
          {`{ [key: string]: ${typeLabel(additional)} }`}
          {typeof schema.description === "string" ? ` — ${schema.description}` : ""}
          {child ? (
            <SchemaTree schema={child} depth={depth + 1} requiredLabel={requiredLabel} />
          ) : null}
        </p>
      );
    }
    return <p className="text-xs text-muted-foreground">{typeLabel(schema)}</p>;
  }
  return (
    <ul
      className={
        depth === 0
          ? "flex flex-col gap-1 text-sm"
          : "mt-1 flex flex-col gap-1 border-l pl-3 text-sm"
      }
    >
      {entries.map(([name, prop]) => {
        const child = childObject(prop);
        const nested = child && child !== prop ? child : prop.properties ? prop : null;
        const label = (
          <>
            <code className="font-mono text-xs">{name}</code>
            <span className="text-xs text-muted-foreground"> {typeLabel(prop)}</span>
            {required.has(name) ? (
              <span className="ml-1 rounded bg-muted px-1 text-[10px] text-muted-foreground uppercase">
                {requiredLabel}
              </span>
            ) : null}
            {typeof prop.description === "string" ? (
              <span className="text-xs text-muted-foreground"> — {prop.description}</span>
            ) : null}
          </>
        );
        if (nested) {
          return (
            <li key={name}>
              <details open={depth < 1}>
                <summary className="cursor-pointer">{label}</summary>
                <SchemaTree schema={nested} depth={depth + 1} requiredLabel={requiredLabel} />
              </details>
            </li>
          );
        }
        return <li key={name}>{label}</li>;
      })}
    </ul>
  );
}
