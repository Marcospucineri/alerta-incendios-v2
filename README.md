# Detección temprana de columnas de humo — v2

Triangulación de focos de incendio a partir de dos observaciones georreferenciadas.
Reescritura de la POC original sobre Node + Express, con brújula del dispositivo,
geolocalización y cálculo geodésico correcto.

## Qué cambia respecto de la v1

| | v1 | v2 |
|---|---|---|
| Cálculo | grados lat/lng como plano cartesiano, con el sistema mal resuelto | intersección de círculos máximos sobre el elipsoide |
| Azimut | transcrito a mano desde una app de terceros | brújula del dispositivo, con corrección por declinación magnética |
| Ubicación | manual (UTM / GMS / clic en mapa) | lo anterior más GPS del dispositivo |
| Resultado | un punto | punto + área de incertidumbre + calidad del cruce |
| Entrada de datos | `prompt()` encadenados | formularios con validación |
| Zona UTM | fija en 20 | parámetro |
| Tiles | endpoint no oficial de Google por HTTP | Esri World Imagery / OSM por HTTPS |
| Compartir | no implementado | WhatsApp y portapapeles |
| Tests | ninguno | 17 casos sobre el núcleo geodésico |

### El bug de la v1, cuantificado

La v1 resolvía la intersección en grados planos y con las componentes del sistema
cruzadas. Contra los dos casos de prueba documentados del proyecto original:

| Caso | Desvío respecto del cálculo correcto |
|---|---|
| INTA Manfredi (visual de 5,3 km) | **527 m** |
| Villa General Belgrano (visual de 1,3 km) | **92 m** |

El error escala con la distancia, que es justamente el caso donde la herramienta
más se necesita.

## Puesta en marcha

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # con recarga automática
npm test           # 17 tests del núcleo geodésico
```

Node 18 o superior.

## La brújula del dispositivo

Sí se puede acceder al magnetómetro desde una web, sin app nativa, mediante
`DeviceOrientationEvent`. Las condiciones son estrictas:

**HTTPS es obligatorio.** En `http://` o `file://` el evento nunca dispara.
Railway sirve HTTPS por defecto. Para probar en local hace falta un túnel:

```bash
npx localtunnel --port 3000
# o
ngrok http 3000
```

**iOS 13+** exige `DeviceOrientationEvent.requestPermission()`, y esa llamada
tiene que originarse en un gesto del usuario — por eso el permiso se pide recién
al tocar "Medir con brújula", nunca al cargar la página. A cambio, iOS entrega
`webkitCompassHeading`, que ya viene referido al norte magnético.

**Android** no expone `webkitCompassHeading`. Se usa el evento
`deviceorientationabsolute` y se deriva el rumbo de `alpha`, que se mide en
sentido antihorario (`azimut = 360 - alpha`). La calidad depende del
magnetómetro del equipo y suele requerir calibración. Hay equipos sin
magnetómetro donde el evento nunca llega: la app espera 3 segundos, avisa y cae
al ingreso manual.

**Declinación magnética.** El sensor entrega rumbo magnético; el mapa trabaja en
rumbo geográfico. En Córdoba la diferencia ronda los -5°, que sobre una visual de
10 km son casi 900 m de desvío. La corrección se aplica en
`magneticDeclination()` ([geo.js](public/js/geo.js)), con un ajuste lineal válido
para el centro-oeste argentino. **Si la app se extiende a otras regiones hay que
reemplazarlo por el modelo WMM.**

**Inclinación.** El magnetómetro se degrada con el teléfono inclinado. La app lee
`beta`/`gamma` y avisa cuando conviene enderezarlo.

La lectura nunca se toma sola: el usuario apunta, ve el número en vivo sobre una
rosa de los vientos, y lo fija con un botón. Siempre puede escribirlo a mano.

## Calidad del resultado

Dos visuales casi paralelas dan una intersección matemáticamente válida pero
operativamente inútil: un grado de error desplaza el foco kilómetros. La app
muestra el **ángulo de corte** y lo califica:

- **> 30°** — buen ángulo de corte
- **15-30°** — ángulo bajo
- **< 15°** — visuales casi paralelas

El **área de incertidumbre** se calcula abriendo cada visual ±N° (ajustable con
el slider) e intersecando los bordes. Cuando el margen de error hace que algún
borde deje de cruzarse, la zona posible deja de estar acotada y la app lo dice
explícitamente en vez de informar un radio engañoso.

Los datos reales del caso INTA Manfredi tienen 12° de corte: la app lo marca en
rojo, que es información operativa valiosa que la v1 no daba.

## Deploy en Railway

1. Subir el repo a GitHub.
2. En Railway: **New Project → Deploy from GitHub repo**.
3. Si `AppV2/` no está en la raíz, definir el **Root Directory** en
   Settings → Service.

No hay más configuración: [railway.json](railway.json) define el build con
Nixpacks, el start command y el healthcheck contra `/health`. El puerto lo
inyecta Railway por `PORT`.

Conviene definir `NODE_ENV=production`, que activa el redirect forzado a HTTPS
(necesario para la brújula) y el cacheo de estáticos.

## Mongo Atlas

**Hoy la app no usa base de datos.** Funciona entera en el cliente y el store
corre en memoria, así que se puede deployar sin cuenta de Atlas.

La estructura queda preparada para enchufarlo sin tocar las rutas.
[src/store.js](src/store.js) tiene la implementación de Mongo escrita y
comentada, con índice `2dsphere` para consultas geoespaciales. Para activarla:

1. `npm install mongodb`
2. Descomentar `createMongoStore` y su rama en `getStore()`
3. Definir `MONGODB_URI` en las variables de Railway
4. En Atlas, permitir el acceso desde cualquier IP (`0.0.0.0/0`), porque Railway
   no publica rangos fijos

La API ya existe y responde contra el store en memoria:

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/reports` | lista los reportes guardados |
| `POST` | `/api/reports` | guarda una triangulación (valida coordenadas y azimuts) |
| `GET` | `/api/observation-points` | puntos de observación precargados |
| `GET` | `/health` | healthcheck de Railway |

## Estructura

```
AppV2/
├── src/
│   ├── server.js     Express, CSP, redirect HTTPS, estáticos
│   ├── routes.js     API y validación
│   └── store.js      persistencia (memoria hoy, Mongo listo)
├── public/
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── geo.js      núcleo geodésico (sin dependencias)
│       ├── compass.js  DeviceOrientationEvent
│       └── app.js      orquestación de la UI
├── test/geo.test.js
└── railway.json
```

`geo.js` y `compass.js` no dependen del DOM ni de Leaflet, y se testean con el
runner nativo de Node. La única dependencia del frontend es Leaflet por CDN.

## Pendiente

- **Declinación magnética por WMM** en lugar de la aproximación regional, si el
  uso se extiende fuera del centro de Argentina.
- **PWA instalable** con service worker, para operar sin señal en el campo.
- **Puntos de observación precargados** (requiere Mongo).
- **Triangulación con más de dos observaciones**, ajustando por mínimos
  cuadrados: más observadores acotan mucho el área.
- **Validación en campo** contra focos de posición conocida, que es la única
  forma de verificar el error real de punta a punta.
