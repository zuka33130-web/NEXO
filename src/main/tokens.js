/** Conteo de conversación: BPE para GPT, estimación existente para otros sitios. */
import { countGptTokens } from '../core/gptTokens.cjs';
import { estimateTokens, estimateOutputTokens } from '../core/text.js';
export { countGptTokens };

/**
 * Qué clase de cifra da este proveedor.
 *
 * `bpe` es un conteo con el diccionario del modelo; `estimate` es la estimación
 * por caracteres que existe para los sitios sin tokenizador propio. El valor se
 * guarda junto al número para no presentar una estimación como si fuera exacta.
 *
 * @param {string} [provider] host o id de sitio (`chatgpt.com`, `claude`…)
 * @returns {'bpe'|'estimate'}
 */
export function tokenCounterForProvider(provider = '') {
  const source = String(provider || '').toLowerCase();
  if (source.includes('chatgpt') || source.includes('openai')) return 'bpe';
  return 'estimate';
}

/**
 * Tokens de entrada de un mensaje.
 *
 * Para ChatGPT/OpenAI usa el BPE del modelo detectado; para el resto mantiene la
 * estimación de siempre. El texto se pasa tal cual: recortarlo cambia la cuenta,
 * porque el BPE cuenta los espacios.
 */
export function countTokensForProvider(text, model = '', provider = '') {
  return tokenCounterForProvider(provider) === 'bpe'
    ? countGptTokens(text, model)
    : estimateTokens(text);
}

/**
 * Tokens de salida de una respuesta capturada.
 *
 * Mismo criterio que la entrada: donde hay tokenizador se cuenta con el
 * diccionario del modelo (`o200k`/`cl100k`); donde no lo hay se conserva la
 * estimación por palabra de siempre, que es una aproximación y nunca se
 * presenta como conteo exacto. El proveedor decide, igual que en la entrada,
 * con `tokenCounterForProvider`.
 *
 * @param {string} text     texto capturado, tal cual se mostró
 * @param {string} [model]  modelo declarado por el sitio o la petición
 * @param {string} [provider] host o id de sitio (`chatgpt.com`, `claude`…)
 * @returns {number}
 */
export function countOutputTokens(text, model = '', provider = '') {
  if (typeof text !== 'string' || text.length === 0) return 0;
  if (tokenCounterForProvider(provider) !== 'bpe') return estimateOutputTokens(text);
  try {
    return countGptTokens(text, model);
  } catch {
    // El diccionario no cargó (paquete incompleto, memoria): la respuesta no se
    // pierde ni deja de contarse. Se usa la estimación de siempre.
    return estimateOutputTokens(text);
  }
}
