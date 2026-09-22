/**
 * Brújula del dispositivo vía DeviceOrientationEvent.
 *
 * Restricciones reales de la plataforma, que condicionan todo este módulo:
 *
 * - HTTPS obligatorio en todos los navegadores. En http:// o file:// el evento
 *   nunca dispara. Railway sirve HTTPS por defecto; en local hace falta un túnel.
 * - iOS 13+ exige DeviceOrientationEvent.requestPermission(), y esa llamada debe
 *   originarse en un gesto del usuario (un click). No se puede pedir al cargar.
 * - iOS expone webkitCompassHeading, ya referido al norte magnético. Es el caso bueno.
 * - Android no lo tiene: hay que usar 'deviceorientationabsolute' y derivar el
 *   rumbo de alpha, que se mide en sentido ANTIHORARIO (azimut = 360 - alpha).
 * - Hay equipos Android sin magnetómetro donde 'absolute' nunca llega. Por eso
 *   todo el flujo tiene que degradar a ingreso manual sin romperse.
 *
 * El valor que entrega este módulo es siempre rumbo MAGNÉTICO. La corrección por
 * declinación se aplica en geo.js, donde se conocen las coordenadas del punto.
 */

const isIOS = () =>
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof DeviceOrientationEvent.requestPermission === 'function';

export function isSupported() {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

export function isSecure() {
  return window.isSecureContext;
}

/**
 * Diagnóstico de por qué la brújula no va a funcionar, para poder decírselo al
 * usuario en vez de dejarlo esperando una lectura que nunca llega.
 */
export function diagnose() {
  if (!isSupported()) {
    return { ok: false, reason: 'Este navegador no expone la orientación del dispositivo.' };
  }
  if (!isSecure()) {
    return {
      ok: false,
      reason:
        'La brújula requiere HTTPS. Abrí la app por https:// (en local, usá un túnel como ngrok).',
    };
  }
  return { ok: true };
}

export class Compass {
  constructor() {
    this.heading = null;      // rumbo magnético en grados
    this.accuracy = null;     // grados de error informados (solo iOS)
    this.tilt = null;         // inclinación del equipo, para advertir al usuario
    this.absolute = false;    // si el rumbo está referido al norte real o es relativo
    this.listeners = new Set();
    this._handler = this._onOrientation.bind(this);
    this._eventName = null;
    this._running = false;
  }

  onUpdate(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Arranca la brújula. DEBE invocarse desde un handler de click: iOS rechaza
   * el pedido de permiso si no viene de un gesto del usuario.
   */
  async start() {
    const diag = diagnose();
    if (!diag.ok) throw new Error(diag.reason);

    if (isIOS()) {
      let state;
      try {
        state = await DeviceOrientationEvent.requestPermission();
      } catch {
        // iOS tira si la llamada no vino de un gesto real
        throw new Error(
          'El permiso debe pedirse desde un toque en pantalla. Volvé a tocar el botón.'
        );
      }
      if (state !== 'granted') {
        throw new Error(
          'Permiso de brújula denegado. Podés habilitarlo en Ajustes > Safari > Movimiento y orientación.'
        );
      }
    }

    // 'deviceorientationabsolute' da rumbo referido al norte real en Android.
    // Safari no lo implementa, pero sí entrega webkitCompassHeading en el evento común.
    this._eventName =
      'ondeviceorientationabsolute' in window
        ? 'deviceorientationabsolute'
        : 'deviceorientation';

    window.addEventListener(this._eventName, this._handler, true);
    this._running = true;

    // Si en unos segundos no llegó ninguna lectura, probablemente no haya
    // magnetómetro. Avisamos en vez de dejar la UI colgada.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.heading === null) {
          this.stop();
          reject(
            new Error(
              'No se reciben lecturas de la brújula. El dispositivo puede no tener magnetómetro.'
            )
          );
        }
      }, 3000);

      const off = this.onUpdate(() => {
        clearTimeout(timer);
        off();
        resolve();
      });
    });
  }

  stop() {
    if (this._eventName) {
      window.removeEventListener(this._eventName, this._handler, true);
    }
    this._running = false;
  }

  get running() {
    return this._running;
  }

  _onOrientation(e) {
    let heading = null;
    let absolute = false;

    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
      // iOS: ya viene como rumbo horario desde el norte magnético
      heading = e.webkitCompassHeading;
      absolute = true;
      this.accuracy = typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : null;
    } else if (typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
      // Android: alpha se mide antihorario desde el norte
      heading = 360 - e.alpha;
      absolute = e.absolute === true || this._eventName === 'deviceorientationabsolute';
    }

    if (heading === null) return;

    // Con la pantalla rotada, el marco de referencia del sensor rota con ella.
    const screenAngle =
      (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    heading = (heading + screenAngle + 360) % 360;

    this.heading = heading;
    this.absolute = absolute;

    // beta/gamma dan la inclinación: apuntar con el teléfono muy inclinado
    // degrada bastante la lectura del magnetómetro.
    if (typeof e.beta === 'number' && typeof e.gamma === 'number') {
      this.tilt = Math.max(Math.abs(e.beta), Math.abs(e.gamma));
    }

    for (const fn of this.listeners) {
      fn({
        heading: this.heading,
        accuracy: this.accuracy,
        tilt: this.tilt,
        absolute: this.absolute,
      });
    }
  }
}

/**
 * Evaluación de la lectura actual, para mostrarle al usuario si puede confiar en ella.
 */
export function assessReading({ accuracy, tilt, absolute }) {
  const warnings = [];
  if (absolute === false) {
    warnings.push('El rumbo no está referido al norte real; calibrá el dispositivo.');
  }
  if (accuracy !== null && accuracy !== undefined && accuracy > 15) {
    warnings.push(`Precisión baja (±${Math.round(accuracy)}°). Movés el equipo en forma de 8 para calibrar.`);
  }
  if (tilt !== null && tilt !== undefined && tilt > 35) {
    warnings.push('Sostené el teléfono más horizontal para mejorar la lectura.');
  }
  return warnings;
}
