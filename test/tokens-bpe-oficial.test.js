/**
 * El conteo BPE contra valores de referencia, sin estimaciones.
 *
 * `countGptTokens` tiene que dar exactamente `|encode(texto, codificación)|`
 * del tokenizador de OpenAI, con el vocabulario que corresponde al modelo. Los
 * números de la tabla se obtuvieron ejecutando el mismo texto con una segunda
 * implementación de tiktoken (`js-tiktoken`, port independiente con los rangos
 * publicados) y coinciden también con `gpt-tokenizer`, que es lo que NEXO usa
 * en producción:
 *
 *   texto                                   caracteres   o200k   cl100k
 *   "hola mundo"                                    10       2        3
 *   "Hola, ¿cómo estás? ç ñ"                        22       8       11
 *   "😄🚀✅"                                         5       5        7
 *   "  hola mundo  "                                14       4        5
 *   "\n\thola\n"                                     7       4        4
 *   "a\tb\tc"                                        5       3        3
 *   "  línea uno\n\tlínea dos  "                    24       8        9
 *   texto largo de 10 925 caracteres             10925    2101     2521
 *   caso real de la entrega (test/fixtures)        933     215      258
 *
 * Ningún valor está estimado por caracteres ni por palabras: todos son conteos
 * del diccionario.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { countTokens as countO200k } from 'gpt-tokenizer';
import { countTokens as countCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { countGptTokens } from '../src/core/gptTokens.cjs';
import { countOutputTokens, countTokensForProvider, tokenCounterForProvider } from '../src/main/tokens.js';
import { estimateOutputTokens, estimateTokens } from '../src/core/text.js';

/**
 * Texto real de la entrega (sin salto de línea final).
 *
 * Se lee tal cual, salvo los saltos CRLF: en un checkout de Windows con
 * `core.autocrlf=true` git convierte LF en CRLF y el fixture dejaría de ser el
 * texto medido (933 → 943 unidades). `.gitattributes` lo impide en los clones
 * nuevos; esta normalización protege a los clones que ya venían convertidos y
 * no cambia nada cuando el archivo está en LF, que es como se midió.
 */
const leerCasoReal = () =>
  readFileSync(new URL('./fixtures/caso-real-2026-11-11.txt', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CASO_REAL = leerCasoReal();
const TEXTO_LARGO = `${'La respuesta larga sigue. '.repeat(420)}FINAL`;

const O200K = [
  ['hola mundo', 10, 2],
  ['Hola, ¿cómo estás? ç ñ', 22, 8],
  ['😄🚀✅', 5, 5],
  ['  hola mundo  ', 14, 4],
  ['\n\thola\n', 7, 4],
  ['a\tb\tc', 5, 3],
  ['  línea uno\n\tlínea dos  ', 24, 8],
];

const CL100K = [
  ['hola mundo', 3],
  ['Hola, ¿cómo estás? ç ñ', 11],
  ['😄🚀✅', 7],
  ['  hola mundo  ', 5],
  ['\n\thola\n', 4],
  ['a\tb\tc', 3],
  ['  línea uno\n\tlínea dos  ', 9],
];

/* ------------------------------------------------------------------ */
/* 1 a 7 · los textos, con sus valores exactos                         */
/* ------------------------------------------------------------------ */

test('texto simple, español, emojis, espacios, saltos y tabulaciones: BPE exacto', () => {
  for (const [texto, caracteres, esperado] of O200K) {
    assert.equal(texto.length, caracteres, `caracteres de ${JSON.stringify(texto)}`);
    assert.equal(countGptTokens(texto, 'gpt-5'), esperado, `o200k de ${JSON.stringify(texto)}`);
    assert.equal(countO200k(texto), esperado, 'y es el mismo número que da el tokenizador');
  }
  for (const [texto, esperado] of CL100K) {
    assert.equal(countGptTokens(texto, 'gpt-4'), esperado, `cl100k de ${JSON.stringify(texto)}`);
    assert.equal(countCl100k(texto), esperado);
  }
});

test('las tres últimas filas que el ojo no ve: prefijos, unicode normalizado y controles', () => {
  // «é» compuesto (e + acento) y «é» precompuesto son textos distintos: cada
  // uno se cuenta con su propio BPE; no se normaliza nada antes de tokenizar.
  const compuesto = 'e\u0301';
  const precompuesto = '\u00e9';
  assert.notEqual(compuesto, precompuesto);
  assert.equal(countGptTokens(compuesto, 'gpt-5'), countO200k(compuesto));
  assert.equal(countGptTokens(precompuesto, 'gpt-5'), countO200k(precompuesto));
  assert.equal(countGptTokens('\u0000', 'gpt-5'), 1, 'un carácter de control también es un token');
  assert.equal(countGptTokens('   ', 'gpt-5'), 1, 'tres espacios son un token, no cero');
  assert.equal(countGptTokens('\n\t', 'gpt-5'), 2, 'un salto y una tabulación son dos');
});

test('texto largo: 10 925 caracteres, 2101 tokens o200k y 2521 cl100k', () => {
  assert.equal(TEXTO_LARGO.length, 10925);
  assert.equal(countGptTokens(TEXTO_LARGO, 'gpt-5'), 2101);
  assert.equal(countGptTokens(TEXTO_LARGO, 'gpt-4'), 2521);
  assert.equal(countO200k(TEXTO_LARGO), 2101);
  assert.equal(countCl100k(TEXTO_LARGO), 2521);
});

test('caso real de la entrega: 933 unidades UTF-16, 215 tokens o200k y 258 cl100k', () => {
  // `String.length` cuenta unidades UTF-16: el emoji 😄 suma dos (932 code points).
  assert.equal(CASO_REAL.length, 933);
  assert.equal([...CASO_REAL].length, 932);
  assert.equal(countGptTokens(CASO_REAL, 'gpt-5'), 215);
  assert.equal(countGptTokens(CASO_REAL, 'gpt-4'), 258);
  assert.equal(countO200k(CASO_REAL), 215);
  assert.equal(countCl100k(CASO_REAL), 258);
  // El salto de línea final que agrega un editor no cambia el conteo.
  assert.equal(countGptTokens(`${CASO_REAL}\n`, 'gpt-5'), 215);
});

/* ------------------------------------------------------------------ */
/* 11 y 12 · selección de codificación por modelo                      */
/* ------------------------------------------------------------------ */

test('los modelos o200k usan o200k_base y los GPT-4/GPT-3.5 clásicos cl100k_base', () => {
  const texto = 'Hola, ¿cómo estás? ç ñ';
  const o200k = countO200k(texto); // 8
  const cl100k = countCl100k(texto); // 11
  assert.notEqual(o200k, cl100k, 'el texto distingue las dos codificaciones');

  for (const modelo of ['gpt-5', 'gpt-5.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.5', 'o1', 'o3', 'chatgpt-4o-latest', '']) {
    assert.equal(countGptTokens(texto, modelo), o200k, `${modelo || '(sin modelo)'} → o200k_base`);
  }
  for (const modelo of ['gpt-4', 'gpt-4-turbo', 'gpt-4-0613', 'gpt-4-32k', 'gpt-3.5-turbo', 'GPT-4']) {
    assert.equal(countGptTokens(texto, modelo), cl100k, `${modelo} → cl100k_base`);
  }
});

test('el contador de la capa de entrada no estima cuando hay tokenizador', () => {
  const texto = CASO_REAL;
  assert.equal(tokenCounterForProvider('chatgpt.com'), 'bpe');
  assert.equal(tokenCounterForProvider('openai'), 'bpe');
  assert.equal(countTokensForProvider(texto, 'gpt-5', 'chatgpt.com'), 215);
  assert.notEqual(estimateTokens(texto), 215, 'la estimación por caracteres habría dado otro número');

  // Proveedor sin tokenizador: se conserva la estimación y se declara como tal.
  assert.equal(tokenCounterForProvider('claude.ai'), 'estimate');
  assert.equal(countTokensForProvider(texto, 'claude-sonnet', 'claude.ai'), estimateTokens(texto));
});

test('salida: BPE del modelo donde hay tokenizador y estimación declarada donde no', () => {
  const respuesta = 'Esta respuesta de prueba tiene siete palabras exactas.';
  assert.equal(respuesta.length, 54);

  // ChatGPT/OpenAI: el mismo diccionario que la entrada.
  assert.equal(countOutputTokens(respuesta, '', 'chatgpt.com'), 10, 'o200k');
  assert.equal(countOutputTokens(respuesta, 'gpt-4-turbo', 'chatgpt.com'), 11, 'cl100k');
  assert.equal(countOutputTokens(respuesta, 'gpt-4-turbo', 'chatgpt.com'), countGptTokens(respuesta, 'gpt-4-turbo'));

  // Proveedor sin tokenizador: se conserva la estimación por palabra de siempre.
  assert.equal(countOutputTokens(respuesta, '', 'claude.ai'), 8);
  assert.equal(countOutputTokens(respuesta, '', 'claude.ai'), estimateOutputTokens(respuesta));
  assert.equal(tokenCounterForProvider('claude.ai'), 'estimate');

  // Entrada y salida no se mezclan: en el proveedor sin tokenizador la entrada
  // se estima por caracteres y la salida por palabras.
  assert.notEqual(countTokensForProvider(respuesta, '', 'claude.ai'), countOutputTokens(respuesta, '', 'claude.ai'));

  // El espacio y el salto sí son tokens; sin texto no hay ninguno.
  assert.equal(countOutputTokens('  \n', '', 'chatgpt.com'), countGptTokens('  \n', ''));
  for (const vacio of ['', null, undefined, 42]) assert.equal(countOutputTokens(vacio), 0);
});

test('un texto vacío o que no es cadena no produce tokens', () => {
  assert.equal(countGptTokens('', 'gpt-5'), 0);
  assert.equal(countGptTokens(undefined, 'gpt-5'), 0);
  assert.equal(countGptTokens(null, 'gpt-4'), 0);
  assert.equal(countGptTokens(42, 'gpt-4'), 0);
  assert.equal(countTokensForProvider('', 'gpt-5', 'chatgpt.com'), 0);
});
