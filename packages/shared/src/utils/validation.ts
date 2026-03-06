import { z } from 'zod';

/** Result type that preserves error information for callers that need diagnostics */
export type SafeParseResult<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: z.ZodError };

/** Safely parse data with a Zod schema, returning a result object with error details */
export function safeParseWithErrors<T extends z.ZodType>(
  schema: T,
  data: unknown,
): SafeParseResult<z.infer<T>> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data, error: null };
  }
  return { success: false, data: null, error: result.error };
}

/** Safely parse data with a Zod schema, returning result or null */
export function safeParse<T extends z.ZodType>(
  schema: T,
  data: unknown,
): z.infer<T> | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

/** Parse and throw on failure with descriptive error */
export function strictParse<T extends z.ZodType>(
  schema: T,
  data: unknown,
  context?: string,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const prefix = context ? `[${context}] ` : '';
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`${prefix}Validation failed: ${issues}`);
  }
  return result.data;
}
