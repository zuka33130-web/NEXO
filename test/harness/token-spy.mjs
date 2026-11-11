/**
 * Sonda del conteo de entrada para las pruebas del proceso principal.
 *
 * Instrumenta `countTokensForProvider` (la puerta única de las rutas de
 * captura) sin cambiar lo que devuelve, y deja constancia de:
 *
 *   · cuántas veces se llamó           → `__nexoTokenCalls`
 *   · con qué texto exacto             → `__nexoTokenArgs`
 *   · de qué proveedor                 → `__nexoProviders`
 *   · con qué clase de cifra se contó  → `__nexoClases` (`bpe` o `estimate`)
 *
 * Así una prueba puede afirmar cuántas veces se tokenizó un mensaje, con qué
 * texto, y si el número es un conteo BPE o la estimación de siempre.
 */

const PUERTA = "export function countTokensForProvider(text, model = '', provider = '') {";
const PUERTA_INSTRUMENTADA = [
  PUERTA,
  '  globalThis.__nexoTokenCalls = (globalThis.__nexoTokenCalls || 0) + 1;',
  '  globalThis.__nexoTokenArgs = [...(globalThis.__nexoTokenArgs || []), String(text)];',
  '  globalThis.__nexoProviders = [...(globalThis.__nexoProviders || []), String(provider)];',
].join('\n');

const CLASE = "  return tokenCounterForProvider(provider) === 'bpe'";
const CLASE_INSTRUMENTADA = [
  '  const __clase = tokenCounterForProvider(provider);',
  '  globalThis.__nexoClases = [...(globalThis.__nexoClases || []), __clase];',
  "  return __clase === 'bpe'",
].join('\n');

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (typeof result.source !== 'string' && !(result.source instanceof Uint8Array)) return result;
  if (!url.endsWith('/src/main/tokens.js')) return result;

  const antes = String(result.source);
  const source = antes.replace(PUERTA, PUERTA_INSTRUMENTADA).replace(CLASE, CLASE_INSTRUMENTADA);
  if (source === antes || !source.includes('__nexoClases')) {
    throw new Error('sonda: no se pudo instrumentar tokens.js');
  }
  return { ...result, source };
}
