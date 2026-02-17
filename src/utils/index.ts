export { Semaphore } from './Semaphore.js';

/**
 * Substitute {{variable}} placeholders in templates
 */
export function substituteTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`;
    result = result.replaceAll(placeholder, String(value));
  }
  return result;
}
