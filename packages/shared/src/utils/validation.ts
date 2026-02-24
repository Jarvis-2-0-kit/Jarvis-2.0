import { z } from 'zod';

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
