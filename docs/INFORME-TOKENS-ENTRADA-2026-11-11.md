# Conteo de tokens de entrada con el BPE real — informe de la corrección

Fecha: 2026-11-11 · Rama de trabajo: `arena/52fbad83-nexo` (base `01ee052`)
Alcance: **tokens de entrada**. Los tokens de salida, la lectura de respuestas y
EVO MEMORY quedan exactamente como estaban (ver §8).

---

## 1. Qué estaba mal

El contador de entrada sumaba un número que no era el del tokenizador del modelo,
por tres motivos independientes que se acumulaban:

| # | Ruta | Defecto | Efecto medido |
|---|------|---------|---------------|
| 1 | Inyección (`src/inject/index.js`) | `gestoDeEnvio()` hacía `textoDelCuadro().trim()` y contaba/tokenizaba ese texto recortado | `"  hola mundo  "` (14 caracteres, 4 tokens o200k) se contaba como 10 caracteres y 2 tokens |
| 2 | Red (`src/main/main.js`) | `textoCuerpo` se recortaba antes de tokenizar y el conteo se hacía dos veces (motor y registro) | 2 llamadas al tokenizador por mensaje; cifras distintas entre motor y registro |
| 3 | CDP (`src/main/cdp.js`) | igual: texto recortado y dos tokenizaciones por petición | 2 llamadas; `chars` del evento distinto del que sumaba el motor |

Además, el prompt del transporte DPU de ChatGPT (formulario `/conversation/updates`)
usaba el texto del formulario sin comprobar si era sólo espacios, y un cuerpo con
mensaje vacío se anunciaba con cifras inventadas en lugar de `0`.

Consecuencia práctica: el panel mostraba un número que no coincidía con el
tokenizador de OpenAI para el mismo texto, y la diferencia crecía con cada
espacio, salto de línea y tabulación del mensaje.

## 2. Fórmula aplicada

```
T = | encode(texto, codificación(modelo)) |
```

`encode` es el BPE del tokenizador (`gpt-tokenizer`, mismo vocabulario y mismas
reglas de combinación que `tiktoken`), `texto` es la cadena capturada **sin
ninguna modificación** y la codificación se elige por modelo:

| Modelo | Codificación |
|--------|--------------|
| `gpt-5`, `gpt-5.x`, `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.5`, `o1`, `o3`, `chatgpt-4o-*`, cuerpo sin modelo | `o200k_base` |
| `gpt-4`, `gpt-4-turbo`, `gpt-4-0613`, `gpt-4-32k`, `gpt-3.5-turbo` | `cl100k_base` |

La selección vive en un único lugar (`src/core/gptTokens.cjs:3-9`) y no se
duplicó: `src/main/tokens.js` sólo decide *si* hay tokenizador para el proveedor.

## 3. Correcciones, archivo por archivo

### `src/inject/index.js` (capa de la página)

- **`gestoDeEnvio()` (línea 275-290).** El texto del cuadro ya no se recorta:
  `const texto = textoDelCuadro(); if (!texto.trim()) return null;`. El `.trim()`
  queda **sólo** como comprobación de vacío; `chars`, `tokenText`, `tokens` y
  `promptHash` salen del texto original. Éste era el defecto de origen: el BPE del
  preload recibía el texto ya recortado y contaba de menos.
- **Prompt DPU (línea 389).** `const prompt = formPrompt.trim() ? formPrompt : (gesture?.tokenText || '')`:
  un formulario con sólo espacios ya no sustituye al texto que escribió la
  persona.
- **Cuerpo JSON sin texto (línea 430).** Se exige `typeof located.value === 'string'`
  y `located.value.trim()`; si no hay texto, el envío se anuncia con `chars: 0`,
  `tokens: 0`, `textFound: false` en vez de tokenizar relleno.

### `src/main/main.js` (proceso principal)

- **Red (línea 1275-1277).** `textoCuerpo` se usa tal cual y el conteo se hace una
  sola vez: `const inputTokens = text.trim() ? countTokensForProvider(text, model, site.id) : 0;`.
  Ese único valor va al motor (`engine.onUserMessage`, línea 1304) y al registro
  (línea 1325); antes había dos tokenizaciones con posibles discrepancias.
- **Registros con origen de la cifra.** `tokensSource: tokenCounterForProvider(...)`
  en los tres caminos: capa (línea 894), red (línea 1326) y CDP (línea 1685).
  `bpe` = diccionario del modelo; `estimate` = estimación por caracteres.

### `src/main/cdp.js` (observación por depurador)

- **`#noteSend` (línea 478-493).** El texto se conserva íntegro (`const text = located && typeof located.value === 'string' ? located.value : '';`),
  el recorte sólo decide si hay mensaje, y `inputTokens` se calcula **una vez** y
  se reutiliza en `engine.onUserMessage` (línea 523) y en el evento `send`
  (línea 538).

### `src/main/tokens.js` (puerta única del conteo)

- Reexporta `countGptTokens`, añade `tokenCounterForProvider(provider)` y
  `countTokensForProvider(text, model, provider)`: BPE para `chatgpt`/`openai`,
  estimación de siempre para el resto. `countOutputTokens` no se tocó.

### Archivos auditados sin cambios necesarios

- `src/core/gptTokens.cjs`: ya implementaba la selección de codificación correcta
  y la carga diferida de los diccionarios; se verificó contra la referencia
  (ver §6) y se dejó igual.
- `src/preload/token-metadata.cjs`: ya convertía `tokenText` a BPE y lo eliminaba
  del IPC; ahora recibe el texto sin recortar y por eso el número es correcto.
- `src/preload/bridge.cjs`: sólo aplica `outgoingMetadata` al tipo `outgoing`
  (línea 196); no había nada que corregir.
- `src/core/sites.js`: `locateUserText()` ya devolvía el texto original del
  cuerpo; el recorte ocurría después, en los tres consumidores corregidos.
- `package.json` / `package-lock.json`: `gpt-tokenizer` 4.1.0 ya incluye
  `o200k_base` y `cl100k_base` resolubles desde Node (`require` desde CJS y
  `import` desde ESM). No se agregó ninguna dependencia de producción.

## 4. Cómo se comprueba que el texto es el mismo de punta a punta

`test/harness/token-spy.mjs` instrumenta (sin cambiar su comportamiento) la
puerta `countTokensForProvider` y deja constancia de: cuántas veces se llamó, con
qué **texto exacto**, de qué proveedor y con qué clase de cifra (`bpe`/`estimate`).
Así las pruebas afirman dos cosas que un número solo no demuestra:

1. que se tokenizó **una sola vez** por mensaje;
2. que el texto que recibió el tokenizador es **byte a byte** el texto capturado.

## 5. Pruebas agregadas

Tres archivos nuevos (25 pruebas). Ninguna prueba existente se borró ni se relajó.

| Archivo | Pruebas | Qué cubre |
|---------|---------|-----------|
| `test/tokens-bpe-oficial.test.js` | 7 | valores exactos contra referencia (texto simple, español, emojis, espacios, saltos, tabulaciones, controles, unicode compuesto), texto largo de 10 925 caracteres, caso real, selección `o200k`/`cl100k` por modelo, ausencia de estimación cuando hay tokenizador, vacíos |
| `test/capa-texto-original.test.js` | 7 | la capa real sobre `build/inject.js` en un contexto de navegador: espacios, saltos, acentos/emojis, gesto de envío sin recorte, cuadro sólo espacios, prompt DPU vacío, cuerpo sin texto |
| `test/contadores-unicos.test.js` | 11 | red y CDP con el tokenizador instrumentado: texto exacto, una llamada por mensaje, deduplicación entre capturadores, dos mensajes idénticos consecutivos, mensajes vacíos, acumulación del total, igualdad de las tres rutas, proveedor sin tokenizador, caso real por red y por CDP, salida y EVO MEMORY intactos |

Correspondencia con los 14 puntos pedidos:

| Punto | Dónde |
|-------|-------|
| 1 texto simple | `tokens-bpe-oficial` — tabla, primera fila |
| 2 español con tildes y signos | `tokens-bpe-oficial` — tabla, segunda fila |
| 3 emojis | `tokens-bpe-oficial` — tabla, tercera fila |
| 4 espacios iniciales y finales | `tokens-bpe-oficial` + `capa-texto-original` + `contadores-unicos` |
| 5 saltos de línea | ídem |
| 6 tabulaciones | ídem |
| 7 texto largo | `tokens-bpe-oficial` — 10 925 caracteres |
| 8 mensajes idénticos consecutivos | `contadores-unicos` — «dos mensajes consecutivos idénticos» |
| 9 mismo mensaje por red y por CDP | `contadores-unicos` — «se deduplica y no se suma dos veces» |
| 10 mensaje vacío | `contadores-unicos` + `capa-texto-original` |
| 11 selección de `o200k_base` | `tokens-bpe-oficial` — 11 modelos |
| 12 selección de `cl100k_base` | `tokens-bpe-oficial` — 6 modelos |
| 13 una sola ejecución por mensaje | `contadores-unicos` — sonda de conteo, todas las rutas |
| 14 texto capturado = texto contabilizado | `contadores-unicos` — el tokenizador recibe el texto exacto |

Las pruebas tienen dientes comprobados por mutación: al reponer
`textoDelCuadro().trim()` en la capa fallan 2 pruebas, y al volver a tokenizar dos
veces en la red falla la de «una sola tokenización».

## 6. Comparación con el tokenizador de referencia

Valores medidos ejecutando el mismo texto con tres caminos: `countGptTokens`
(lo que usa NEXO), `gpt-tokenizer` directo y `js-tiktoken` (implementación
independiente del algoritmo de `tiktoken` con los rangos publicados).

| Texto | Caracteres | NEXO `gpt-5` | `js-tiktoken` o200k | NEXO `gpt-4` | `js-tiktoken` cl100k |
|-------|-----------:|-------------:|--------------------:|-------------:|---------------------:|
| `hola mundo` | 10 | 2 | 2 | 3 | 3 |
| `Hola, ¿cómo estás? ç ñ` | 22 | 8 | 8 | 11 | 11 |
| `😄🚀✅` | 5 | 5 | 5 | 7 | 7 |
| `  hola mundo  ` | 14 | 4 | 4 | 5 | 5 |
| `\n\thola\n` | 7 | 4 | 4 | 4 | 4 |
| `a\tb\tc` | 5 | 3 | 3 | 3 | 3 |
| `  línea uno\n\tlínea dos  ` | 24 | 8 | 8 | 9 | 9 |
| texto largo (`La respuesta larga sigue. ` × 420 + `FINAL`) | 10 925 | 2101 | 2101 | 2521 | 2521 |
| **caso real §9** (`test/fixtures/caso-real-2026-11-11.txt`) | 933 | **215** | 215 | **258** | 258 |

Comprobación cruzada adicional: 500 textos generados de forma determinista con
espacios, `\n`, `\t`, `\r\n`, acentos, `«»`, `—`, `…`, emojis con ZWJ (`👩‍💻`),
banderas (`🇦🇷`), CJK (`Ω 日本`), comparados entre las dos implementaciones:
**500/500 coincidencias, 0 discrepancias**.

### Caso real de la entrega (§9)

El texto guardado en `test/fixtures/caso-real-2026-11-11.txt` (933 caracteres,
sin salto de línea final; agregarlo no cambia el resultado) da:

- **`o200k_base` (GPT-5.x, GPT-4o, GPT-4.1, GPT-4.5, o1, o3): 215 tokens.**
- **`cl100k_base` (GPT-4, GPT-4-turbo, GPT-3.5): 258 tokens.**

No son 213 ni 326: esos números corresponden a otras condiciones de entrada
(otro recorte del texto, otra codificación o el texto con el prefijo `[EVO …]`
todavía sin resolver). NEXO da 215 con o200k para el texto exacto de este archivo.

### Nota de transparencia sobre la referencia

El paquete oficial de Python (`tiktoken`) **no se pudo usar en este entorno**:
descarga su vocabulario desde `openaipublic.blob.core.windows.net`, un host que la
sesión no alcanza (error TLS al pedir `o200k_base.tiktoken`). Por eso la
referencia se hizo con dos implementaciones independientes que traen los rangos
publicados dentro del paquete (`js-tiktoken`, port directo de `tiktoken`, y
`gpt-tokenizer`, que es el que usa NEXO), y ambas coinciden en los 9 casos y en
los 500 aleatorios. Para confirmarlo con el tokenizador oficial en una máquina con
red abierta:

```python
import tiktoken
texto = open("test/fixtures/caso-real-2026-11-11.txt", encoding="utf-8").read()
print(len(texto))                                          # 933
print(len(tiktoken.get_encoding("o200k_base").encode(texto)))   # 215
print(len(tiktoken.get_encoding("cl100k_base").encode(texto)))  # 258
```

## 7. Resultados de las ejecuciones

Todas ejecutadas en este árbol, con `npm ci --ignore-scripts` y
`node scripts/build-inject.mjs` antes de las pruebas.

| Comando | Resultado real |
|---------|----------------|
| `node --test test/tokens-bpe-oficial.test.js` | 7 pruebas, 7 pasan, 0 fallan |
| `node --test test/capa-texto-original.test.js` | 7 pruebas, 7 pasan, 0 fallan |
| `node --test test/contadores-unicos.test.js` | 11 pruebas, 11 pasan, 0 fallan |
| `npm test` (suite completa) | **832 pruebas, 831 pasan, 1 omitida, 0 fallan** |
| `npm run verify` | empaquetado de la capa ✔ · pruebas automatizadas ✔ · «Verificación automática OK» |
| `node scripts/build-inject.mjs` | `inject.js listo · 53.7 kB (19.3 kB gzip) · 11 módulos` |

La prueba omitida es la que ya existía y depende del binario de Electron
(`dist:win`), no de este cambio.

## 8. Confirmación de que no se rompió nada

- **EVO MEMORY**: no se tocó ni una línea de `src/memory/**` ni de los receptores
  de memoria. Prueba nueva: un snapshot de conversación con espacios, saltos y
  tabulaciones se guarda **byte a byte** y no mueve ningún contador.
- **Tokens de salida**: `countOutputTokens` sigue siendo la misma estimación de
  siempre (una unidad por palabra capturada). Prueba nueva: una respuesta de ocho
  palabras suma exactamente 8, y las respuestas no cambian de cifra.
- **Lectura de respuestas**: intacta en las tres rutas; la única modificación de
  `cdp.js` está en la anotación del mensaje del usuario, no en la captura de la
  respuesta (las pruebas de respuesta y de memoria siguen pasando).
- **Deduplicación**: se conserva y se verifica (red + CDP del mismo envío suman
  una vez; dos envíos iguales seguidos suman dos).
- **Datos y archivos**: no se borró ni se renombró ningún archivo, ajuste,
  registro ni prueba. Las pruebas existentes no se modificaron; sólo se agregaron
  tres archivos de prueba y un fixture.
- **Interfaz**: sin cambios. El único dato nuevo es `tokensSource` en el registro
  (`bpe`/`estimate`), un metadato que ya se enviaba en los eventos.

## 9. Entrega

- ZIP del proyecto: `Nexo-0.1.33-conteo-tokens-final.zip` (249 entradas,
  `build/inject.js` regenerado e incluido, sin `node_modules` ni `.git`).
- SHA-256 del ZIP: se informa en el mensaje de entrega y en el archivo
  `SHA256.txt` que acompaña al ZIP (no puede ir dentro del propio ZIP sin cambiar
  su hash).
- Comparación con el tokenizador: §6.
- Limitación que sigue en pie: el arranque real de Electron, `dist:win` y el
  checklist manual de `docs/NAVEGADOR.md` no se pueden ejecutar en este entorno;
  `npm run verify` lo declara explícitamente.
