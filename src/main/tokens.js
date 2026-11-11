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

/** Salida IA: una unidad estimada por palabra capturada, sin tokenizador. */
export function countOutputTokens(text) {
  return estimateOutputTokens(text);
}
