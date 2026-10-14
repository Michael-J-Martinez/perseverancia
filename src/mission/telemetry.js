// Mini API de telemetría con el mismo patrón que Open MCT (src/api/telemetry/TelemetryAPI.js):
// cada dato es un objeto con su metadato (nombre, unidad, proveedor) y los proveedores
// se registran aparte y responden a request() (historial) y subscribe() (en vivo).
// La vista nunca sabe de dónde viene el dato: solo pide y se suscribe.

const providers = [];

export function addProvider(provider) {
  providers.push(provider);
}

const findProvider = (obj, capability) => providers.find((p) => p[capability]?.(obj));

/** Metadato del dato: { key, name, unit, provider } (como valueMetadatas en Open MCT). */
export function getMetadata(obj) {
  const provider = findProvider(obj, 'supportsRequest') ?? findProvider(obj, 'supportsSubscribe');
  return { key: obj.key, name: obj.name, unit: obj.unit, provider: provider?.name ?? '—' };
}

/** Historial completo: lista de { x, y } (x = sol de la misión). */
export function request(obj) {
  const provider = findProvider(obj, 'supportsRequest');
  if (!provider) return Promise.reject(new Error(`Sin proveedor de historial para ${obj.key}`));
  return provider.request(obj);
}

/** Valores en vivo: llama a callback({ x, y }) y devuelve la función para desuscribirse. */
export function subscribe(obj, callback) {
  const provider = findProvider(obj, 'supportsSubscribe');
  return provider ? provider.subscribe(obj, callback) : () => {};
}
