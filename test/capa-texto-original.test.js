/**
 * La capa de la página, ejecutada de verdad, con el texto tal como se escribió.
 *
 * El error que estas pruebas cierran: `gestoDeEnvio()` recortaba el texto del
 * cuadro (`textoDelCuadro().trim()`) antes de contar caracteres y tokens. Con
 * eso, `"  hola mundo  "` se contaba como `"hola mundo"`: dos tokens menos, y
 * los espacios iniciales y finales —que el BPE cuenta— desaparecían del número.
 *
 * Acá se comprueba, sobre `build/inject.js` en un contexto con las piezas del
 * navegador, que el texto que viaja al proceso principal es el original
 * carácter por carácter (espacios, saltos de línea, tabulaciones, acentos y
 * emojis) y que un envío se anuncia una sola vez, con una sola cifra.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { estimateTokens, fingerprint } from '../src/core/text.js';

const RUTA = new URL('../build/inject.js', import.meta.url);
const fuente = existsSync(RUTA) ? readFileSync(RUTA, 'utf8') : null;
const faltaBuild = !fuente && 'falta build/inject.js (npm run build:inject)';

/** Mundo mínimo con lo que la capa usa de la pestaña. */
function crearMundo(options = {}) {
  const { host = 'chatgpt.com', pathname = '/c/abc-12345678', stream = '' } = options;

  const listeners = [];
  const salientes = [];
  const peticiones = [];

  const fetchNativo = async (input, init) => {
    peticiones.push({ input: String(input), init });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  const cuadro = options.cuadro || null;
  const boton = { disabled: false, matches: (sel) => /send-button|Send|Enviar/i.test(String(sel)), closest: () => boton };
  const objetivo = {
    closest: (sel) => (/button/i.test(String(sel)) ? boton : cuadro ? cuadro.closest(sel) : null),
  };
  const manejadores = { click: [], keydown: [], submit: [] };

  const window = {
    __NEXO_CONFIG__: { host, enabled: true, settings: {}, language: 'es', version: '0.1.0', site: 'chatgpt' },
    location: { href: `https://${host}${pathname}`, hostname: host, pathname, protocol: 'https:' },
    fetch: fetchNativo,
    addEventListener: (tipo, fn) => { if (tipo === 'message') listeners.push(fn); },
    removeEventListener: () => {},
    postMessage: (msg) => {
      salientes.push(msg);
      if (msg.__nexo !== 'call') return;
      setTimeout(() => {
        const data = { __nexo: 'reply', id: msg.id, payload: { text: String(msg.payload?.prompt || '') } };
        for (const fn of listeners) fn({ source: window, data });
      }, 0);
    },
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    ReadableStream,
    WritableStream,
    TransformStream,
    Response,
    Headers,
    Request,
    URL,
    URLSearchParams,
    FormData,
    console,
    navigator: { userAgent: 'Chrome' },
    document: {
      querySelector: (sel) => {
        if (!cuadro) return null;
        return /prompt|textarea|contenteditable/i.test(String(sel)) ? cuadro : null;
      },
      querySelectorAll: () => [],
      addEventListener: (tipo, fn) => {
        if (!manejadores[tipo]) manejadores[tipo] = [];
        manejadores[tipo].push(fn);
      },
    },
  };
  window.window = window;

  vm.runInContext(fuente, vm.createContext(window), { filename: 'inject.js' });

  const pulsar = (tipo, evento) => { for (const fn of manejadores[tipo] || []) fn(evento); };
  return {
    window,
    salientes,
    peticiones,
    pulsarEnviar: () => pulsar('click', { target: objetivo }),
    pulsarEnter: () => pulsar('keydown', { key: 'Enter', shiftKey: false, isComposing: false, target: objetivo }),
  };
}

/** Cuadro de diálogo falso con el texto exacto que escribió la persona. */
function cuadroCon(texto) {
  const el = {
    tagName: 'DIV',
    innerText: texto,
    textContent: texto,
    focus() {},
    closest: (sel) => (/contenteditable|prompt/i.test(String(sel)) ? el : null),
  };
  return el;
}

const cuerpoChatGPT = (texto) => JSON.stringify({
  action: 'next',
  messages: [{ id: 'm-1', author: { role: 'user' }, content: { content_type: 'text', parts: [texto] } }],
});

const sse = (texto) => `data: ${JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: texto })}\n\ndata: [DONE]\n\n`;

const eventos = (mundo, tipo) => mundo.salientes.filter((m) => m.type === tipo);
const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Envía un cuerpo de conversación y devuelve el aviso `outgoing` que produjo. */
async function enviarPorPeticion(texto, extra = {}) {
  const mundo = crearMundo({ stream: sse('Respuesta de prueba'), ...extra });
  const respuesta = await mundo.window.fetch('/backend-api/conversation', {
    method: 'POST',
    body: cuerpoChatGPT(texto),
  });
  await respuesta.text();
  await espera(40);
  const avisos = eventos(mundo, 'outgoing');
  assert.equal(avisos.length, 1, 'un envío, un solo aviso');
  return { mundo, aviso: avisos[0].payload };
}

/* ------------------------------------------------------------------ */
/* el texto original, sin recorte                                      */
/* ------------------------------------------------------------------ */

test('los espacios iniciales y finales llegan intactos y se cuentan una vez', { skip: faltaBuild }, async () => {
  const texto = '  hola mundo  ';
  const { mundo, aviso } = await enviarPorPeticion(texto);

  assert.equal(aviso.chars, 14, 'los 14 caracteres escritos, no 10');
  assert.equal(aviso.tokenText, texto, 'el texto que tokeniza el preload es el original');
  assert.equal(aviso.tokens, estimateTokens(texto), 'una sola cifra en la capa, la suya');
  assert.equal(aviso.textFound, true);
  assert.equal(aviso.promptHash, fingerprint(texto), 'la huella sale del mismo texto');

  // El cuerpo que sale al servidor no se toca: contar no puede reescribir.
  assert.equal(mundo.peticiones.length, 1);
  assert.equal(JSON.parse(mundo.peticiones[0].init.body).messages[0].content.parts[0], texto);
});

test('saltos de línea y tabulaciones cuentan como caracteres y no se recortan', { skip: faltaBuild }, async () => {
  const texto = '\n\thola\n';
  const { aviso } = await enviarPorPeticion(texto);

  assert.equal(aviso.chars, 7);
  assert.equal(aviso.tokenText, texto, 'el salto inicial y el final siguen ahí');
  assert.equal(aviso.tokens, estimateTokens(texto));
});

test('acentos, signos y emojis viajan enteros', { skip: faltaBuild }, async () => {
  const texto = 'Hola, ¿cómo estás? 😊 ç ñ';
  const { aviso } = await enviarPorPeticion(texto);

  assert.equal(aviso.chars, 25);
  assert.equal(aviso.tokenText, texto);
  assert.equal(aviso.tokens, estimateTokens(texto));
});

/* ------------------------------------------------------------------ */
/* el gesto de enviar: el mismo texto, sin recorte                      */
/* ------------------------------------------------------------------ */

test('el gesto de enviar cuenta el texto del cuadro sin recortarlo', { skip: faltaBuild }, async () => {
  const texto = '  hola mundo  ';
  const mundo = crearMundo({ cuadro: cuadroCon(texto) });

  mundo.pulsarEnviar();
  mundo.pulsarEnter();
  assert.equal(eventos(mundo, 'outgoing').length, 0, 'el gesto espera a la petición');

  // Sin petición que lo confirme, el gesto cuenta solo al vencer la espera.
  await espera(2700);
  const avisos = eventos(mundo, 'outgoing');
  assert.equal(avisos.length, 1, 'click y Enter del mismo envío no cuentan dos veces');
  const aviso = avisos[0].payload;
  assert.equal(aviso.source, 'composer');
  assert.equal(aviso.chars, 14, 'antes de la corrección contaba 10');
  assert.equal(aviso.tokenText, texto, 'y tokenizaba «hola mundo»');
  assert.equal(aviso.tokens, estimateTokens(texto));
});

test('un cuadro con sólo espacios no anuncia ningún envío', { skip: faltaBuild }, async () => {
  const mundo = crearMundo({ cuadro: cuadroCon('   \n\t ') });

  mundo.pulsarEnviar();
  await espera(2700);
  assert.equal(eventos(mundo, 'outgoing').length, 0, 'no hay mensaje que contar');
});

/* ------------------------------------------------------------------ */
/* transportes alternativos y cuerpos sin texto                        */
/* ------------------------------------------------------------------ */

test('el prompt DPU vacío no borra el texto del gesto', { skip: faltaBuild }, async () => {
  const texto = '  hola mundo  ';
  const mundo = crearMundo({ cuadro: cuadroCon(texto) });
  mundo.pulsarEnviar();

  const cuerpo = new URLSearchParams({ prompt: '   ' });
  const respuesta = await mundo.window.fetch('/backend-api/unauth-mweb/conversation/updates', {
    method: 'POST',
    body: cuerpo,
  });
  await respuesta.text();
  await espera(40);

  const avisos = eventos(mundo, 'outgoing');
  assert.equal(avisos.length, 1, 'un envío, un aviso');
  assert.equal(avisos[0].payload.tokenText, texto, 'se cuenta lo que escribió la persona, no los espacios del formulario');
  assert.equal(avisos[0].payload.chars, 14);
});

test('un cuerpo de conversación con sólo espacios se cuenta sin inventar cifras', { skip: faltaBuild }, async () => {
  const { aviso } = await enviarPorPeticion('   \n\t ');

  assert.equal(aviso.chars, 0, 'sin caracteres de texto');
  assert.equal(aviso.tokens, 0, 'sin tokens');
  assert.equal(aviso.tokenText, '', 'no se tokeniza el relleno como si fuera contenido');
  assert.equal(aviso.textFound, false, 'y queda dicho que el texto no se pudo leer');
});
