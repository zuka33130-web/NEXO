# Auditoría del repositorio NEXO — 0.1.33

Fecha: 2026-11-11 · Rama auditada: `arena/52fbad83-nexo` (base `01ee052` de `main`)
Complementa —no reemplaza— [`AUDITORIA.md`](AUDITORIA.md), que describe la pasada
anterior. Acá se informa el estado **actual y comprobado** del repositorio, con la
evidencia de cada afirmación y las correcciones propuestas en orden de prioridad.

---

## 0. Alcance, método y límites

**Qué se revisó:** todo el árbol versionado (22 111 líneas de código en `src/`,
14 723 en `test/`, 63 archivos de prueba, 41 documentos).

**Qué se ejecutó:** instalación limpia de dependencias (`npm ci`), suite completa
(4 corridas normales, 1 con `--test-concurrency=32`, 1 sin `build/`), cobertura
experimental, `npm run verify`, `npm audit`, revisión estática de la superficie
IPC/preload/protocolo/permisos, y consulta de la única corrida de CI del
repositorio (`gh run view 42942958692`).

**Qué NO se pudo validar** (y por lo tanto no se afirma nada sobre ello):

| No validado | Motivo |
|---|---|
| Arranque real de Electron (`npm start`, `npm run dev`) | El binario de Electron no se descarga en este entorno; no hay display |
| `npm run dist:win` (ZIP, asar, icono, metadatos) | Requiere descargar el Electron de Windows |
| `scripts/humo.mjs` y `scripts/probes/repetition-electron.cjs` | Idem; su estado se deduce del informe de CI |
| Conversación real contra ChatGPT/Claude | Sin cuenta ni red hacia los proveedores |
| Log crudo del job de Windows | El host de logs está fuera del alcance de red; se usó el *check run* `diagnostico` que el propio flujo publica |

El checklist manual de diez puntos de [`NAVEGADOR.md`](NAVEGADOR.md) §3 sigue sin cubrirse
por ningún medio automático: esa limitación ya estaba declarada y se mantiene.

---

## 1. Veredicto

El núcleo del producto está en buen estado: la suite pasa completa en un árbol
con artefactos, el motor es isomorfo y testeable, no hay telemetría, y las
decisiones de seguridad del proceso principal (protocolo `nexo://`, permisos,
`will-attach-webview`, herramientas externas con confirmación) están bien
resueltas y cubiertas por pruebas.

Lo que **no** está en estado entregable es la cadena de distribución y la
coherencia documental: la única corrida de CI del repositorio está en rojo y
detiene el empaquetado antes de generar el ZIP, `npm test` falla en un clon
recién bajado, y la documentación de auditoría y privacidad describe una versión
anterior del producto.

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| B-01 | CI rojo: la sonda de Electron clickea una pestaña que 0.1.33 eliminó → no hay ZIP ni release | **Crítico** | Confirmado en CI |
| B-02 | `npm test` en clon limpio: 34 pruebas fallan y 13 se saltan | **Alto** | Reproducido |
| B-03 | `docs/AUDITORIA.md` declara 248 pruebas y todo en verde; hoy son 806 y el CI está rojo | Medio | Confirmado |
| S-01 | 49 manejadores IPC sin verificación de remitente (incluye borrados y ajustes) | **Alto** (defensa en profundidad) | Confirmado |
| S-02 | Una página puede forzar una escritura sincrónica del perfil por mensaje (sin límite de tasa) | Medio | Confirmado |
| S-03 | El payload de `nexo:event` no tiene esquema por tipo: la página puede inflar contadores | Medio | Confirmado |
| S-04 | `nexo:shell:config` devuelve una ruta absoluta del disco a cualquier renderer | Bajo | Confirmado |
| S-05 | La barra de direcciones usa `loadURL` sin la lista de esquemas que sí aplica `will-attach-webview` | Bajo | Confirmado |
| S-06 | `mergeSettings` persiste claves arbitrarias del patch (incluida `__proto__`) | Bajo | Confirmado |
| R-01 | En producción no hay manejador global de excepciones; sólo en modo humo | Medio | Confirmado |
| R-02 | `nexo-profile.json` se escribe sin `tmp`+`rename`, a diferencia del resto de los almacenes | Bajo | Confirmado |
| R-03 | Los fallos de escritura de EVO MEMORY se descartan sin registro | Bajo | Confirmado |
| R-04 | Duplicación estructural: `fileStorage` ×2, chequeo de confianza ×3, URL de la shell ×5 | Bajo | Confirmado |
| P-01 | Cobertura baja donde más duele: `src/inject/index.js` 57 % líneas / 20 % ramas, `advancedBrowser.js` 35 % | Medio | Medido |
| D-01 | 5 vulnerabilidades moderadas en dependencias (sólo cadena de `@electron/packager`) | Bajo | `npm audit` |
| D-02 | Acciones de GitHub fijadas por etiqueta y `contents: write` a nivel de flujo | Bajo | Confirmado |
| D-03 | Sin `LICENSE` y sin `author`/`license`/`repository` en `package.json` | Medio (legal) | Confirmado |
| C-01 | 22 enlaces a `EvoMaxPC/navegador` en 10 archivos, incluido el menú de la app y el botón de descarga del README | Medio | Confirmado |
| C-02 | `PRIVACIDAD.md` dice «un único archivo» y «ninguna llamada a servicios de terceros»; ya no es cierto | Medio | Confirmado |
| T-01 | No hay pruebas de autorización por canal, de fallo de disco ni de que las sondas apunten a selectores existentes | Medio | Confirmado |

---

## 2. Bloqueantes

### B-01 · La compilación de Windows está rota y nadie puede bajar el ejecutable

**Evidencia.** La única corrida de CI del repositorio (`main`, commit `01ee052`):

```
X main Compilar para Windows · 42942958692
  ✓ Verificación automática
  X Conversación en Electron real (fixture HTTPS sin red)
  - Empaquetar
  - Dejar el ZIP como artefacto
```

El paso que falla es `.github/workflows/compilar-windows.yml:59`, que ejecuta
`scripts/probes/repetition-electron.cjs`. El `check run` `diagnostico` que el
propio flujo publica al fallar contiene la causa exacta:

```json
{ "ok": false,
  "checks": ["shell creada", "shell lista"],
  "error": "TypeError: Cannot read properties of null (reading 'click')\n    at <anonymous>:1:309" }
```

La sonda hace, en la línea 54:

```js
document.querySelector('.stab[data-panel="repetition"]').click();
```

Ese elemento ya no existe: 0.1.33 retiró la pestaña Repetición, y hay una prueba
que **exige** que no exista (`test/wormhole-identity.test.js:206`:
`assert.doesNotMatch(html, /data-panel="repetition"/)`).

**Impacto.** No se genera el `.exe`, no queda artefacto `Nexo-win32-x64`, no se
publica la release: el producto no se puede distribuir. Además el repositorio
tiene dos aserciones contradictorias —una prueba que prohíbe el panel y un paso
de CI que lo requiere— y ninguna prueba detecta la contradicción.

**Corrección.** Reescribir la sonda contra la interfaz vigente: la vista de
conversación que sobrevivió es la de EVO Memory (`#memoryLiveConversation`), que
usa el mismo lector compartido (`src/ui/shell/repetition.js` montado en
`app.js:943`). Los tramos posteriores de la sonda ya la usan, así que el tramo
inicial es el que quedó del diseño anterior. Estimación: 1–2 h.

**Prevención.** Una prueba estática que verifique que cada selector usado en
`scripts/probes/*.cjs` existe en `src/ui/shell/index.html` — el mismo estilo del
contrato HTML↔interfaz que ya existe en `test/shell-contract.test.js`.

### B-02 · En un clon limpio, `npm test` falla

**Evidencia.** Se retiró `build/` (está en `.gitignore`, así que no existe en un
clon nuevo) y se corrió la suite:

```
# tests 806 · # pass 759 · # fail 34 · # skipped 13
```

Las 34 fallas están todas en `test/chatgpt-output-circuit.test.js`; el mensaje
del preload es explícito:

```
[nexo] falta build/inject.js — ejecutá «npm run build:inject»
```

Ese archivo no usa guarda de `skip` (a diferencia de `test/capa-inyectada.test.js`
y `test/rendimiento.test.js`, que sí la tienen) y por eso falla en vez de saltar.
Con `build/` presente: **805 pasan, 1 se salta** (la cadena de empaquetado).

**Impacto.** `package.json:16` declara `"test": "node --test"`, y ese es el primer
comando que corre cualquiera que clona el repositorio. Falla. Peor: sin artefactos,
otras 13 pruebas **se saltan en silencio**, incluidas casi todas las de la capa
inyectada, que es el corazón del producto. Un «verde» sin `build/` no significa nada.

**Corrección.** `"pretest": "node scripts/build-inject.mjs"` (idempotente, ~0,2 s),
o bien cargar el bundle bajo demanda desde `test/harness/`. Estimación: 15 min.

### B-03 · La documentación de auditoría describe otro estado del producto

`docs/AUDITORIA.md:7` afirma «**248 pruebas, 247 pasan, 1 se saltea**» y «el
`nexo.exe` empaquetado arranca y se autodiagnostica en verde». Hoy hay 806
pruebas en 63 archivos, y la única compilación existente en este repositorio
**no llega a empaquetar** (B-01). El documento también presenta como pendientes
cosas que ya se hicieron y omite módulos nuevos (`conversationOptimizer`,
`workDossier`, `advancedBrowser`, `understandingReader`).

**Corrección.** Convertir `AUDITORIA.md` en histórico fechado y dejar este
informe como estado vigente; o reescribir sus cifras al cerrar B-01/B-02.

---

## 3. Seguridad

Contexto que se confirma como correcto: la shell corre con
`contextIsolation`, sin `nodeIntegration` y con `sandbox` (`main.js:356-360`); cada
webview se endurece en `will-attach-webview` (`main.js:394-404`); el protocolo
`nexo://` valida traversal, prefijo y lista blanca de extensiones
(`main.js:234` + `internalAssets.js`); los permisos se resuelven por host y
nunca por defecto; la página **no** tiene `contextBridge` ni acceso a Node
(`bridge.cjs` no usa `contextBridge` en absoluto) y el único canal que puede pedir
por `postMessage` es `prepare` (`bridge.cjs:141-160`); las herramientas externas
pasan por lista de esquemas **y** un diálogo de confirmación
(`advancedBrowser.js:90-104`). Eso está bien pensado y probado.

Lo que queda abierto:

### S-01 · Alta · Manejadores IPC sin verificación de remitente

`isShellRequest()` existe (`main.js:548`) y se aplica en descargas, repetición y
comprensión, pero **no** en 49 de los 61 manejadores de `main.js`. Entre ellos, los
destructivos o de política:

| Canal | Línea | Efecto |
|---|---|---|
| `nexo:settings:set` / `reset` | 655 / 662 | cambia mediación, sitios, memoria |
| `nexo:log:clear` | 671 | borra el libro |
| `nexo:memory:clear` / `forget` / `import` | 802 / 795 / 797 | borra o inyecta memoria |
| `nexo:profile:clear` | 919 | borra perfil |
| `nexo:history:clear` | 935 | borra historial |
| `nexo:bookmarks:clear` | 965 | borra marcadores |
| `nexo:permissions:set` | 1011 | concede permisos por sitio |
| `nexo:data:clear` | 1033 | borra cookies y caché |
| `nexo:session:capture` | 1055 | escribe sesión |
| `nexo:open-external` | 906 | abre el SO |
| `nexo:cdp:stats` | 682 | expone ruta del diagnóstico |

**Por qué importa aunque hoy no sea explotable:** el único motivo por el que una
pestaña no puede llamarlos es que `bridge.cjs` no expone `invoke` genérico. Es una
sola línea de código la que separa «la página no puede» de «la página sí puede», y
`bridge.cjs` corre con `sandbox: false` y `require` disponible. El propio
documento de criterios exige «validación y propiedad de recursos en main»
(`docs/NEXO-CRITERIOS-RECTORES.md`, límites no negociables).

**Corrección.** Envolver los manejadores privilegiados en un `handleShell(channel,
fn)` que aplique `isShellRequest` y devuelva `{ok:false}` si no; agregar a
`test/shell-contract.test.js` una prueba que enumere los canales del preload y
exija que los marcados como privilegiados llamen a `isShellRequest`. Estimación:
2–3 h.

### S-02 · Media · Amplificación de escritura en disco desde una página

`main.js:822` acepta `nexo:event` de cualquier webview con forma válida. Para
`type === 'outgoing'` hace `store.pushLog(entry)` (línea 897), y `pushLog` llama a
`save()`, que escribe **todo** el perfil con `writeFileSync` (`store.js:33-38`).
No hay límite de tasa ni deduplicación por clave en ese camino (`noteDiagnostic`
sí la tiene: 30 s por clave, `main.js:283`).

Un bucle de `window.postMessage({__nexo:'event', type:'outgoing', …})` en cualquier
sitio produce una escritura sincrónica de un JSON de hasta ~400 entradas por
mensaje, en el proceso principal, con la interfaz esperando. Es un DoS trivial y
además ensucia el libro de intervenciones.

**Corrección.** Contador por `webContents.id` con ventana deslizante (p. ej. máx.
20 envíos/minuto), y guardado diferido del perfil como ya se hace con la
navegación (`scheduleProfileSave`, `main.js`).

### S-03 · Media · El payload de los eventos no tiene esquema por tipo

`eventMessage()` (`validate.js:74-100`) valida `type` contra una lista cerrada,
que `payload` sea objeto y que el serializado no pase de 20 KB. No valida campos.
Como `chars`, `tokens`, `managed` y `messageId` llegan al motor y a los contadores
(`engine.onUserMessage`), una página puede inflar los números que el usuario ve
como si fueran mediciones.

**Corrección.** Esquema por tipo: lista de claves permitidas y tipos por
`type`, con recorte numérico, igual que ya se hace en `captureDiagnostic.js`
(lista cerrada de campos). Estimación: 1 h.

### S-04 · Bajo · Ruta absoluta expuesta

```js
ipcMain.handle('nexo:shell:config', () => ({
  version: app.getVersion(),
  pagePreload: `file://${PAGE_PRELOAD}`,   // main.js:807-811
  platform: process.platform,
}));
```

El valor se usa para crear webviews, así que no se puede quitar sin cambiar el
diseño; pero no hace falta entregarlo a cualquier remitente. Aplicar S-01.

### S-05 · Bajo · `loadURL` sin lista de esquemas

`navigate()` usa `tab.view.loadURL(target)` (`app.js:371`) sin repetir el control
de `will-attach-webview`. `resolveInput` (`nav/url.js:86`) deja pasar cualquier
`esquema://`, y `KNOWN_SCHEMES` incluye `file:`, `data:` y `blob:`. Hoy la
consecuencia está acotada (la preload no se expone en esos orígenes y `boot()`
corta si el protocolo no es `http(s)`), pero el camino debería validar el esquema
igual que el otro.

**Corrección.** Filtrar en `navigate()` a `http/https/nexo/about`; reservar
`file:`/`data:` para una acción explícita del usuario, si se quiere conservar.
Estimación: 30 min.

### S-06 · Bajo · `mergeSettings` acepta claves arbitrarias

`core/settings.js:72-80` copia con `out[key] = structuredClone(value)`. Un patch
con `__proto__` no contamina `Object.prototype` (porque la rama `isPlainObject`
copia primero), pero sí cambia el prototipo del objeto de ajustes y persiste
claves desconocidas en el perfil. No hay lista blanca de claves.

**Corrección.** Ignorar `__proto__`, `constructor` y `prototype`, y descartar
claves que no existan en `DEFAULT_SETTINGS`. Estimación: 30 min + prueba.

---

## 4. Robustez y mantenimiento

### R-01 · Media · Sin manejador global de errores en producción

`main.js:109-110` instala `uncaughtException` y `unhandledRejection` **sólo** si
`isSmoke && smokeOut`. En uso normal, una excepción no capturada en el proceso
principal cierra el navegador sin rastro (y con él todas las pestañas). Dado que
hay `await` sobre disco, CDP y diálogos por todos lados, conviene un manejador que
registre en el libro de intervenciones y no derribe la ventana.

### R-02 · Bajo · Perfil sin escritura atómica

`store.js:33-38` escribe `nexo-profile.json` directamente, mientras `files.js:10-40`
y `workDossier.js` usan `tmp`+`rename`. Un corte de energía a mitad de escritura
deja el archivo truncado y `load()` cae a valores por defecto **en silencio**: se
pierden ajustes y libro.

### R-03 · Bajo · Fallo de escritura de memoria invisible

`main/memory.js:31-40` (`fileStorage.write`) no captura errores, mientras
`memory/store.js:80-96` envuelve la llamada en `try/catch` y devuelve `false`. El
resultado es honesto en la API, pero no queda ningún registro de que la memoria no
se está persistiendo; el panel sigue diciendo «guardado».

### R-04 · Bajo · Duplicación con riesgo de deriva

- `fileStorage` duplicado en `main/files.js` y `main/memory.js` (dos
  implementaciones con manejo de errores distinto).
- El chequeo de confianza está escrito tres veces:
  `main.js:548` (`isShellRequest`), `advancedBrowser.js:48` (`trusted`),
  `workDossier.js:129` (`trusted`).
- La URL literal `'nexo://app/src/ui/shell/index.html'` aparece cinco veces
  (`main.js:152, 550, 710`, `advancedBrowser.js:23`, `workDossier.js:134`). Si
  alguna vez cambia la ruta de la shell, hay que acordarse de las cinco.
- `main.js` tiene 1843 líneas y 61 manejadores IPC en un solo archivo.

**Corrección sugerida.** Un módulo `src/main/trust.js` con `SHELL_URL`,
`isShell(event)` y `handleShell(channel, fn)`; usarlo en los tres módulos y en los
manejadores privilegiados (resuelve S-01 y R-04 de una vez).

---

## 5. Rendimiento

- **P-01 (medido).** Cobertura de líneas por módulo: núcleo 87–100 %, memoria
  95–100 %, `main.js` 89 %, **`advancedBrowser.js` 35 %**, **`inject/index.js`
  57 %** (ramas 20 %), `ui/shell/chatgptDirect.js` 58 %. Las dos zonas con menos
  cobertura son justamente las que tocan el depurador y el mundo de la página.
- **Escritura por turno.** Cada `pushLog` serializa y escribe el perfil completo
  de forma sincrónica (ver S-02). Con 400 entradas el archivo pesa cientos de KB;
  se paga en el proceso principal en cada intervención.
- **Vigilancia de red.** `webRequest.onBeforeRequest` y `onCompleted` se registran
  para `*://*/*` (`main.js:1363, 1406, 1479`) y ejecutan lógica por petición en
  cada navegación. Está acotado por listas y `Map`s con tope, pero conviene una
  medición A/B (la infraestructura ya existe: `NEXO_NETWATCH=0` y
  `scripts/bench.mjs`).

No se encontraron intervalos sin limpiar: los `Map` por pestaña se liberan en
`destroyed` (`main.js:510`, `1836`, `advancedBrowser.js:622`).

---

## 6. Dependencias y cadena de suministro

- **D-01.** `npm audit`: 5 moderadas, todas en la cadena de desarrollo
  (`@electron/packager` → `@electron/asar` → `glob`/`minimatch`). No viajan al
  `.exe`, pero corren en el runner que produce el binario. `--force` propone un
  downgrade disruptivo de packager: conviene fijar la versión corregida de
  `glob`/`minimatch` cuando packager la adopte, y no forzar el cambio.
- **D-02.** `.github/workflows/compilar-windows.yml` usa acciones por etiqueta
  (`actions/checkout@v4`, `softprops/action-gh-release@v2`) y declara
  `permissions: contents: write` a nivel de flujo. Fijar por SHA y mover los
  permisos al paso que los necesita reduce el riesgo de que una etiqueta movida
  publique una release.
- **D-03.** No hay `LICENSE` en la raíz y `package.json` no tiene `license`,
  `author` ni `repository`. GitHub informa `license: null` para este repositorio (y
  también para `EvoMaxPC/navegador`). Sin licencia, el uso y la redistribución del
  código no están concedidos por escrito, algo especialmente relevante para un
  producto que se distribuye como ZIP.
- **D-04.** `dev/probe-streaming.cjs` requiere `playwright-core` y
  `@sparticuz/chromium`, que no están en `package.json` ni en el lockfile. Está
  documentado como instalación manual externa
  ([`STREAMING-0.1.23.md`](STREAMING-0.1.23.md):84), así que no es un error, pero
  el script no es reproducible desde el repositorio.

---

## 7. Documentación y coherencia

### C-01 · Media · Los enlaces apuntan a otro repositorio

22 apariciones de `EvoMaxPC/navegador` en 10 archivos. Las dos que importan:

- `src/main/menu.js:111`: el ítem **Acerca de** del menú de la aplicación abre
  `https://github.com/EvoMaxPC/navegador#readme`, no este repositorio.
- `README.md:118`: el botón «Descargar la compilación corregida 0.1.13» apunta a un
  artefacto de un flujo ajeno (`actions/runs/42651499665`), con retención de 30
  días: el enlace está vencido y, además, describe una versión de hace 20
  versiones.

El resto (`docs/EMPAQUETADO.md`, `RENDIMIENTO.md`, notas de versión) es histórico y
puede quedar, pero conviene una nota al inicio de esos archivos.

### C-02 · Media · `PRIVACIDAD.md` quedó corto

Afirma que se guarda «un único archivo» `<userData>/nexo-profile.json` y que no hay
«llamadas a servicios de terceros». El código escribe además:

| Archivo | Origen |
|---|---|
| `<userData>/evo-memory-<proyecto>.json` | `main/memory.js:44` |
| `<userData>/history.json`, `bookmarks.json`, `downloads.json`, `session.json`, `permissions.json`, `zoom.json` | `main/profile.js:34-39` |
| `<userData>/browser-tools.json` | `advancedBrowser.js:36` |
| `<userData>/work-dossiers/<espacio>.json` | `workDossier.js:125, 43` |
| `Documentos/NEXO-CAPTURE-DIAGNOSTIC.jsonl` (+ `.1` a los 5 MiB) | `main.js:1610` |

Y hay aperturas de servicios externos con el texto o la URL del usuario
(Traducir, Buscar imagen en Lens, Buscar selección: `advancedBrowser.js:356-362,
490, 530-544`). Están mediadas por un diálogo de confirmación explícito, lo cual es
la conducta correcta, pero el documento debería decirlo en lugar de negarlo.

### C-03 · Bajo · Otros desajustes verificados

- El README promete «`npm run dist:win` genera `nexo.exe`»; en este repositorio ese
  camino nunca llegó a ejecutarse (B-01).
- `docs/COMPRENSION-ARCHIVOS.md` referencia `docs/NEXO-CAPA1-0.1.33.md`, presente;
  en cambio `docs/AUDITORIA.md` y `docs/NAVEGADOR.md` §3 siguen describiendo un
  producto anterior en cifras y módulos.
- `src/ui/shell/repetition.js` se llama «repetición» pero hoy sólo alimenta la
  vista en vivo de EVO Memory (`app.js:943`): el nombre arrastra un módulo retirado.

---

## 8. Pruebas: qué cubren y qué no

Fortalezas reales: 806 pruebas en 63 archivos, con arnés propio de Electron
(`test/harness/`) que levanta el `main.js` de producción; contrato HTML↔preload↔main
(`shell-contract.test.js`); separación explícita entre «lo observado» y «lo mediado»;
y pruebas de privacidad del diagnóstico. Cobertura del núcleo 87–100 %.

Huecos concretos:

| Hueco | Consecuencia | Prueba sugerida |
|---|---|---|
| Autorización por canal IPC | S-01 queda a un descuido de ser explotable | Enumerar canales del preload y exigir chequeo en los privilegiados |
| Selectores de `scripts/probes/*` vs HTML | Es la causa de B-01 | Contraste estático sonda ↔ `index.html` |
| Fallo de disco en `save()` | R-02/R-03 sin red | Almacén que lanza; verificar que no se pierde el estado previo y que se registra |
| Límite de tasa de `nexo:event` | S-02 indetectable | Ráfaga de N eventos y tope de escrituras |
| Payload por tipo de evento | S-03 indetectable | Campos inválidos deben descartarse, no recortarse |
| `inject/index.js` ramas (20 %) | La capa que corre en la página es la menos probada por ramas | Casos de `fetch` raro: `body` como stream, `Request` reconsumido, respuestas sin cuerpo |

**Sobre la estabilidad de la suite.** La primera corrida de esta auditoría mostró
41 fallas que no volvieron a reproducirse en cinco corridas posteriores (incluida
una con `--test-concurrency=32`, que dio 805/0). La causa reproducible es B-02
(artefactos faltantes); la corrida anómala ocurrió antes de que existiera `build/`,
así que lo más probable es que sea el mismo origen con otro recuento. Queda
anotado como observación, no como defecto confirmado, porque no hay registro que
permita atribuirlo.

---

## 9. Plan de corrección propuesto

**Fase 1 — desbloquear la entrega (medio día).**
1. B-01: reescribir el tramo inicial de `scripts/probes/repetition-electron.cjs`
   contra `#memoryLiveConversation`; correr el flujo de Windows y confirmar ZIP.
2. B-02: `pretest` con `build-inject.mjs`; guarda de `skip` en
   `chatgpt-output-circuit.test.js` para el caso de artefactos ausentes.
3. C-01: `SHELL_URL`/enlaces al repositorio correcto, y reemplazar el botón de
   descarga vencido por un enlace a *Releases*.
4. C-03/B-03: corregir cifras de `AUDITORIA.md` o marcarlo como histórico.

**Fase 2 — cerrar la superficie (1 día).**
5. `src/main/trust.js` + `handleShell()`; aplicarlo a los 11 canales de S-01
   (resuelve también R-04).
6. R-01: manejador global de excepciones que registre y no derribe la ventana.
7. S-02 + S-03: límite de tasa por pestaña y esquema de payload por tipo.
8. Pruebas de contrato para 5, 7 y los selectores de sondas.

**Fase 3 — higiene (1 día).**
9. S-04, S-05, S-06; R-02 (perfil atómico); R-03 (registrar fallo de memoria).
10. C-02: reescribir `PRIVACIDAD.md` con la tabla real de archivos y la mención de
    los servicios externos con confirmación.
11. D-02: acciones por SHA y permisos por paso.
12. D-03: decidir licencia y completar metadatos de `package.json`.

---

## 10. Anexo · Mediciones crudas

```
node -v                             v22.22.3
npm ci --ignore-scripts             5 moderate severity vulnerabilities
node --test (con build/)            # tests 806 · pass 805 · fail 0 · skipped 1 · 101 s
node --test (sin build/)            # tests 806 · pass 759 · fail 34 · skipped 13
node --test --test-concurrency=32   # tests 806 · pass 805 · fail 0
node --test --experimental-test-coverage
   src/inject/index.js              57.26 % líneas · 20.57 % ramas
   src/main/advancedBrowser.js      35.01 % líneas · 58.33 % ramas
   src/main/main.js                 89.09 % líneas · 71.53 % ramas
   src/ui/shell/chatgptDirect.js    58.44 % líneas
npm run verify                      ✔ Empaquetado de la inyección · ✔ Pruebas · exit 0
gh run list                         1 corrida · failure (run 42942958692)
gh api .../check-runs               Windows x64 = failure · diagnostico = neutral
```

Tamaño: 22 111 líneas de JS/CJS en `src/`, 14 723 en `test/`, 63 archivos de
prueba, 41 documentos, 5,2 MB de árbol versionado.
