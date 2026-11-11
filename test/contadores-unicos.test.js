/**
 * Los contadores de entrada vistos desde el proceso principal, con el texto
 * original y una sola tokenización por mensaje.
 *
 * Estas pruebas instrumentan el tokenizador real (`src/main/tokens.js`): cada
 * llamada a `countTokensForProvider` se registra con el texto exacto que recibió
 * (ver `test/harness/token-spy.mjs`). Así se puede afirmar algo que ninguna
 * cifra sola demuestra: **cuántas veces** se tokenizó un mensaje y **qué texto**
 * llegó al tokenizador, no sólo cuántos tokens salieron.
 *
 * Cubre las tres rutas de captura (red, CDP y el aviso de la capa ya convertido
 * por el preload), su deduplicación, los mensajes vacíos, la acumulación del
 * total, la estimación para proveedores sin tokenizador y que ni la salida ni
 * EVO MEMORY cambien.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register, createRequire } from 'node:module';
import { test } from 'node:test';
import { countTokens as countO200k } from 'gpt-tokenizer';
import { estimateTokens } from '../src/core/text.js';

/**
 * Texto real de la entrega (§9): 933 caracteres, 215 tokens o200k.
 * Los CRLF de un checkout de Windows se normalizan a LF (ver `.gitattributes`).
 */
const CASO_REAL = readFileSync(new URL('./fixtures/caso-real-2026-11-11.txt', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

process.env.NEXO_NETRESP_MS = '1';

// Sonda y cargador se registran antes de importar el proceso principal: si
// `tokens.js` se cargara antes, la copia quedaría sin instrumentar.
register('./harness/token-spy.mjs', import.meta.url);
register('./harness/loader.mjs', import.meta.url);

const { countGptTokens, countOutputTokens, countTokensForProvider, tokenCounterForProvider } =
  await import('../src/main/tokens.js');
const { journal } = await import('./harness/electron-stub.mjs');
await import('../src/main/main.js');

const require = createRequire(import.meta.url);
const { outgoingMetadata } = require('../src/preload/token-metadata.cjs');

/** Textos que recibió el tokenizador desde que se reinició la sonda. */
const tokenizados = () => (globalThis.__nexoTokenArgs ? [...globalThis.__nexoTokenArgs] : []);
const clases = () => (globalThis.__nexoClases ? [...globalThis.__nexoClases] : []);
const reiniciarSonda = () => { globalThis.__nexoTokenCalls = 0; globalThis.__nexoTokenArgs = []; globalThis.__nexoClases = []; };

// La sonda tiene que estar viva: sin esto, «una sola llamada» sería una prueba
// que pasa porque no mira nada.
reiniciarSonda();
assert.equal(countTokensForProvider('sonda', '', 'chatgpt.com'), countO200k('sonda'));
assert.deepEqual(tokenizados(), ['sonda'], 'la sonda de conteo está activa');
assert.deepEqual(clases(), ['bpe'], 'y distingue un conteo BPE de una estimación');

const espera = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

function callIpc(channel, payload, senderId = 1) {
  const handler = journal.ipcHandlers.get(channel);
  assert.ok(handler, `no hay handler para ${channel}`);
  return handler({ sender: { id: senderId } }, payload);
}

const stats = () => callIpc('nexo:stats');
const registro = () => callIpc('nexo:log');

const PARTITION = 'persist:nexo';

/** Una pestaña nueva, tal como la adjunta la interfaz. */
async function abrir(url, titulo = 'ChatGPT') {
  const view = journal.windows[0].attachWebview(url);
  view.navigateTo(url, titulo);
  await espera(url.includes('claude') ? 120 : 80);
  return view;
}

/** La petición que Chromium entrega a `webRequest.onBeforeRequest`. */
function peticionRed({ url, cuerpo, webContentsId = 1 }) {
  const mano = journal.webRequest.before.get(PARTITION);
  assert.ok(mano, 'el vigilante de red está escuchando');
  const detalles = {
    url,
    method: 'POST',
    resourceType: 'xhr',
    webContentsId,
    uploadData: cuerpo ? [{ bytes: Buffer.from(cuerpo, 'utf8') }] : undefined,
  };
  let resultado = null;
  mano.listener(detalles, (respuesta) => { resultado = respuesta; });
  return resultado;
}

const cuerpoChatGPT = (texto) => JSON.stringify({
  action: 'next',
  messages: [{ author: { role: 'user' }, content: { content_type: 'text', parts: [texto] } }],
});

const cuerpoClaude = (texto) => JSON.stringify({ prompt: texto });

const URL_RED_CHATGPT = 'https://chatgpt.com/backend-api/f/conversation';
const URL_RED_CLAUDE = 'https://claude.ai/api/organizations/org-1/chat_conversations/conv-1/completion';

// El registro llega del más nuevo al más antiguo: el primero es el de esta prueba.
const entrada = async (code) => (await registro()).find((item) => item.code === code);

/* ------------------------------------------------------------------ */
/* red                                                                 */
/* ------------------------------------------------------------------ */

test('red: el texto original se tokeniza una vez y con sus espacios', async () => {
  const texto = '  hola mundo  ';
  const view = await abrir('https://chatgpt.com/c/unicos-red');

  reiniciarSonda();
  const antes = await stats();
  peticionRed({ url: URL_RED_CHATGPT, cuerpo: cuerpoChatGPT(texto), webContentsId: view.id });
  await espera();

  assert.deepEqual(tokenizados(), [texto], 'una sola tokenización, con el texto completo');
  assert.deepEqual(clases(), ['bpe'], 'y es BPE del modelo, no estimación');
  assert.equal(countO200k(texto), 4, 'referencia: o200k cuenta 4 para este texto');

  const despues = await stats();
  assert.equal(despues.messages, antes.messages + 1, 'un mensaje');
  assert.equal(despues.inputTokens, antes.inputTokens + 4, 'y cuatro tokens de entrada, ni dos ni ocho');

  const aviso = await entrada('outgoing-network');
  assert.equal(aviso.meta.chars, 14, 'los caracteres son los del texto original');
  assert.equal(aviso.meta.tokens, 4, 'la misma cifra que vio el motor');
  assert.equal(aviso.meta.tokensSource, 'bpe', 'y se declara como BPE, no como estimación');
});

test('red: dos mensajes consecutivos idénticos son dos mensajes y dos conteos', async () => {
  const texto = 'repetido  ';
  const view = await abrir('https://chatgpt.com/c/unicos-red-repetido');

  reiniciarSonda();
  const antes = await stats();
  peticionRed({ url: URL_RED_CHATGPT, cuerpo: cuerpoChatGPT(texto), webContentsId: view.id });
  await espera();
  peticionRed({ url: URL_RED_CHATGPT, cuerpo: cuerpoChatGPT(texto), webContentsId: view.id });
  await espera();

  const esperado = countO200k(texto);
  assert.ok(esperado > 0);
  assert.deepEqual(tokenizados(), [texto, texto], 'dos envíos, dos tokenizaciones');
  const despues = await stats();
  assert.equal(despues.messages, antes.messages + 2, 'ninguno de los dos se descarta');
  assert.equal(despues.inputTokens, antes.inputTokens + esperado * 2, 'el total suma los dos');
});

test('red: un mensaje sin texto cuenta el envío y no inventa tokens', async () => {
  const view = await abrir('https://chatgpt.com/c/unicos-red-vacio');

  reiniciarSonda();
  const antes = await stats();
  peticionRed({ url: URL_RED_CHATGPT, cuerpo: cuerpoChatGPT('   '), webContentsId: view.id });
  await espera();
  peticionRed({ url: URL_RED_CHATGPT, cuerpo: cuerpoChatGPT('\n\t '), webContentsId: view.id });
  await espera();

  assert.deepEqual(tokenizados(), [], 'no se tokeniza relleno');
  const despues = await stats();
  assert.equal(despues.messages, antes.messages + 2, 'los dos envíos existen');
  assert.equal(despues.inputTokens, antes.inputTokens, 'sin tokens de entrada');
});

test('red: el total de entrada acumula exactamente lo que suman los mensajes', async () => {
  const view = await abrir('https://chatgpt.com/c/unicos-red-total');
  const textos = ['hola mundo', '  hola mundo  ', 'a\n\nb\tc'];
  assert.deepEqual(textos.map((t) => countO200k(t)), [2, 4, 4], 'valores de referencia de o200k');

  reiniciarSonda();
  const antes = await stats();
  for (const texto of textos) {
    peticionRed({ url: URL_RED_CHATGPT, cuerpo: cuerpoChatGPT(texto), webContentsId: view.id });
    await espera();
  }

  assert.deepEqual(tokenizados(), textos, 'un conteo por mensaje, en orden');
  const despues = await stats();
  assert.equal(despues.messages, antes.messages + 3);
  assert.equal(despues.inputTokens, antes.inputTokens + 10, '2 + 4 + 4, sin redondeos');
});

/* ------------------------------------------------------------------ */
/* CDP                                                                 */
/* ------------------------------------------------------------------ */

test('CDP: el texto original se tokeniza una vez y el evento lleva la misma cifra', async () => {
  const texto = '  hola mundo  ';
  const view = await abrir('https://chatgpt.com/c/unicos-cdp');

  reiniciarSonda();
  const antes = await stats();
  view.debugger.emitEvent('Network.requestWillBeSent', {
    requestId: 'req-cdp-unicos',
    type: 'XHR',
    request: { url: URL_RED_CHATGPT, method: 'POST', postData: cuerpoChatGPT(texto) },
  });
  await espera(120);

  assert.deepEqual(tokenizados(), [texto], 'una sola tokenización, con el texto completo');
  assert.deepEqual(clases(), ['bpe'], 'y es BPE del modelo');
  const despues = await stats();
  assert.equal(despues.messages, antes.messages + 1, 'un mensaje');
  assert.equal(despues.inputTokens, antes.inputTokens + 4, 'cuatro tokens');

  const aviso = await entrada('outgoing-cdp');
  assert.equal(aviso.meta.chars, 14, 'los caracteres del texto original');
  assert.equal(aviso.meta.tokens, 4, 'la misma cifra que sumó el motor');
  assert.equal(aviso.meta.tokensSource, 'bpe');
});

test('CDP y red: el mismo envío se deduplica y no se suma dos veces', async () => {
  const texto = '  deduplicado  ';
  const view = await abrir('https://chatgpt.com/c/unicos-dedupe');

  reiniciarSonda();
  const antes = await stats();
  view.debugger.emitEvent('Network.requestWillBeSent', {
    requestId: 'req-dedupe',
    type: 'XHR',
    request: { url: URL_RED_CHATGPT, method: 'POST', postData: cuerpoChatGPT(texto) },
  });
  await espera(120);
  peticionRed({ url: URL_RED_CHATGPT, cuerpo: cuerpoChatGPT(texto), webContentsId: view.id });
  await espera(120);

  const despues = await stats();
  assert.equal(despues.messages, antes.messages + 1, 'un envío, un mensaje');
  assert.equal(despues.inputTokens, antes.inputTokens + countO200k(texto), 'una vez los tokens, no dos');
  assert.equal((await registro()).filter((item) => item.code === 'outgoing-network' && item.meta.chars === texto.length).length, 0,
    'el segundo capturador no vuelve a registrar el envío');
});

test('el caso real de la entrega se cuenta igual por red y por CDP, una sola vez', async () => {
  assert.equal(CASO_REAL.length, 933);
  const cuerpo = cuerpoChatGPT(CASO_REAL);

  const porRed = await abrir('https://chatgpt.com/c/unicos-real-red');
  reiniciarSonda();
  const antesRed = await stats();
  peticionRed({ url: URL_RED_CHATGPT, cuerpo, webContentsId: porRed.id });
  await espera(120);
  const despuesRed = await stats();

  assert.deepEqual(tokenizados(), [CASO_REAL], 'el tokenizador recibe el texto byte a byte');
  assert.deepEqual(clases(), ['bpe'], 'con el diccionario del modelo');
  assert.equal(despuesRed.messages, antesRed.messages + 1);
  assert.equal(despuesRed.inputTokens, antesRed.inputTokens + 215, '215 tokens o200k, no una estimación');
  const avisoRed = await entrada('outgoing-network');
  assert.equal(avisoRed.meta.chars, 933);
  assert.equal(avisoRed.meta.tokens, 215);
  assert.equal(avisoRed.meta.tokensSource, 'bpe');

  const porCdp = await abrir('https://chatgpt.com/c/unicos-real-cdp');
  reiniciarSonda();
  const antesCdp = await stats();
  porCdp.debugger.emitEvent('Network.requestWillBeSent', {
    requestId: 'req-real-cdp',
    type: 'XHR',
    request: { url: URL_RED_CHATGPT, method: 'POST', postData: cuerpo },
  });
  await espera(150);
  const despuesCdp = await stats();

  assert.deepEqual(tokenizados(), [CASO_REAL], 'también una sola tokenización por CDP');
  assert.equal(despuesCdp.messages, antesCdp.messages + 1);
  assert.equal(despuesCdp.inputTokens, antesCdp.inputTokens + 215, 'la misma cifra que por red');
  const avisoCdp = await entrada('outgoing-cdp');
  assert.equal(avisoCdp.meta.chars, 933);
  assert.equal(avisoCdp.meta.tokens, 215);
  assert.equal(avisoCdp.meta.tokensSource, 'bpe');
});

/* ------------------------------------------------------------------ */
/* las tres rutas dan la misma cifra                                   */
/* ------------------------------------------------------------------ */

test('inyección, red y CDP dan la misma cifra para el mismo texto y modelo', async () => {
  const texto = '  hola mundo  ';
  const modelo = 'gpt-5';

  // 1) Preload: convierte el texto del aviso de la capa con el BPE del modelo.
  const delPreload = outgoingMetadata({ tokenText: texto, host: 'chatgpt.com', model: modelo, chars: texto.length, tokens: estimateTokens(texto) });
  // 2) Red y 3) CDP: el mismo tokenizador y el mismo modelo.
  const deRed = countTokensForProvider(texto, modelo, 'chatgpt.com');
  const deCdp = countTokensForProvider(texto, modelo, 'chatgpt.com');

  assert.equal(delPreload.tokens, 4, 'el preload da 4, no la estimación de 5');
  assert.equal(delPreload.tokenText, undefined, 'y el texto no viaja al proceso principal');
  assert.equal(deRed, 4);
  assert.equal(deCdp, 4);
  assert.equal(delPreload.tokens, deRed, 'la capa, la red y CDP coinciden');
  assert.equal(deRed, deCdp);
  assert.equal(deRed, countO200k(texto));
  assert.equal(tokenCounterForProvider('chatgpt.com'), 'bpe');
});

/* ------------------------------------------------------------------ */
/* proveedores sin tokenizador                                         */
/* ------------------------------------------------------------------ */

test('un proveedor sin tokenizador conserva la estimación y la declara', async () => {
  const texto = '  hola mundo  ';
  const view = await abrir('https://claude.ai/chat/unicos-estimacion', 'Claude');

  reiniciarSonda();
  const antes = await stats();
  peticionRed({ url: URL_RED_CLAUDE, cuerpo: cuerpoClaude(texto), webContentsId: view.id });
  await espera(120);

  assert.deepEqual(tokenizados(), [texto], 'se cuenta una sola vez, con el texto completo');
  assert.deepEqual(clases(), ['estimate'], 'con la estimación de siempre, sin BPE');
  const despues = await stats();
  assert.equal(despues.messages, antes.messages + 1);
  assert.equal(despues.inputTokens, antes.inputTokens + 5, 'la estimación de siempre: 5');

  const aviso = await entrada('outgoing-network');
  assert.equal(aviso.meta.tokens, 5);
  assert.equal(aviso.meta.tokens, estimateTokens(texto), 'exactamente la misma estimación de antes');
  assert.equal(aviso.meta.tokensSource, 'estimate', 'y se identifica como estimación');
  assert.equal(tokenCounterForProvider('claude.ai'), 'estimate');

  const delPreload = outgoingMetadata({ tokenText: texto, host: 'claude.ai', model: 'claude-sonnet', tokens: 5 });
  assert.equal(delPreload.tokens, 5, 'el preload no pisa la estimación de un proveedor sin BPE');
  assert.equal(delPreload.tokenText, undefined);
});

/* ------------------------------------------------------------------ */
/* lo que no debía cambiar                                             */
/* ------------------------------------------------------------------ */

test('los tokens de salida se cuentan con el BPE del modelo y la estimación queda para el resto', async () => {
  const view = await abrir('https://chatgpt.com/c/unicos-salida');
  const respuesta = 'Esta respuesta de prueba tiene siete palabras exactas.';

  reiniciarSonda();
  const antes = await stats();
  view.debugger.emitEvent('Network.requestWillBeSent', {
    requestId: 'req-salida',
    type: 'XHR',
    request: { url: URL_RED_CHATGPT, method: 'POST', postData: cuerpoChatGPT('contá también mi respuesta') },
  });
  await espera(120);
  view.debugger.bodies.set('req-salida', JSON.stringify({
    message: { author: { role: 'assistant' }, content: { parts: [respuesta] } },
  }));
  view.debugger.emitEvent('Network.responseReceived', {
    requestId: 'req-salida',
    type: 'XHR',
    response: { url: URL_RED_CHATGPT, status: 200, mimeType: 'application/json' },
  });
  view.debugger.emitEvent('Network.loadingFinished', { requestId: 'req-salida' });
  await espera(200);

  const despues = await stats();
  assert.equal(despues.responses, antes.responses + 1, 'una respuesta');
  assert.equal(despues.outputTokens, antes.outputTokens + countOutputTokens(respuesta, '', 'chatgpt.com'), 'BPE del modelo');
  assert.equal(despues.outputTokens, antes.outputTokens + 10, 'diez tokens o200k, no las ocho palabras');
  assert.equal(countOutputTokens(respuesta, 'gpt-4-turbo', 'chatgpt.com'), 11, 'cl100k cuenta once');
  assert.equal(countOutputTokens(respuesta, '', 'claude.ai'), 8, 'sin tokenizador queda la estimación por palabra');
  assert.equal(despues.inputTokens, antes.inputTokens + countTokensForProvider('contá también mi respuesta', '', 'chatgpt.com'),
    'y la entrada se cuenta aparte, sin mezclarse con la salida');
});

test('EVO MEMORY guarda el texto tal cual y no mueve los contadores', async () => {
  const url = 'https://chatgpt.com/c/unicos-memoria';
  const view = await abrir(url);
  const ajustes = await callIpc('nexo:settings:get');
  await callIpc('nexo:settings:set', { ...ajustes, memory: { ...(ajustes.memory || {}), enabled: true } });

  const usuario = '  Decidimos usar PostgreSQL para la biblioteca.  ';
  const respuesta = '\n  Primera parte de la respuesta.\n\nSegunda parte.  \n';
  const antes = await stats();

  // El receptor comprueba el remitente real: la pestaña, no un identificador.
  const recibirSnapshot = journal.ipcHandlers.get('nexo:conversation-snapshot');
  const resultado = recibirSnapshot({ sender: view, senderFrame: view.mainFrame }, {
    href: url,
    streaming: false,
    turns: [
      { id: 'uni-u', role: 'user', content: usuario },
      { id: 'uni-a', role: 'assistant', content: respuesta },
    ],
  });

  assert.equal(resultado.ok, true, 'el snapshot autorizado se guarda');

  const conversaciones = await callIpc('nexo:memory:conversations');
  const guardada = conversaciones.find((item) => item.conversationId === '/c/unicos-memoria');
  assert.ok(guardada, 'la conversación queda en EVO MEMORY');
  assert.equal(guardada.turns.find((turn) => turn.id === 'uni-u').content, usuario, 'el mensaje del usuario se guarda sin recortar');
  assert.equal(guardada.turns.find((turn) => turn.id === 'uni-a').content, respuesta, 'y la respuesta, igual');

  const despues = await stats();
  assert.equal(despues.messages, antes.messages, 'leer la conversación no cuenta envíos');
  assert.equal(despues.responses, antes.responses, 'ni respuestas');
  assert.equal(despues.inputTokens, antes.inputTokens, 'ni mueve los tokens de entrada');
  assert.equal(despues.outputTokens, antes.outputTokens, 'ni los de salida');
});
