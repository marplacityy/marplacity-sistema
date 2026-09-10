/** SDK ficticio: solo se incluye en el paquete --mode prueba; nunca toca Firebase. */
const UID = 'usuario-prueba';
const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const docs = new Map(Object.entries({
  [`config/${UID}`]: { userId: UID, nombre: 'MarplaCity', localNombre: 'MarplaCity', tc: '1400', cats: ['Servicios', 'Otros'], medios: ['Efectivo', 'Transferencia'], icats: ['Accesorios', 'Repuestos'], repUltimoNum: 12, ventanaMeses: 12 },
  'stock/equipo-1': { userId: UID, nombre: 'iPhone 15', gb: '128GB', color: 'Negro', imei: '123456789012345', valorUSD: 400, precioVenta: 550, precioSugerido: 550, status: 'en_stock', bateria: 90, fechaEntrada: fecha, tipo: 'compra' },
  'inventario/funda-1': { userId: UID, nombre: 'Funda iPhone 15', categoria: 'Accesorios', qty: 5, costo: 3, precio: 10, precioSugerido: 10, moneda: 'USD', minStock: 2 },
  'inventario/pantalla-1': { userId: UID, nombre: 'Pantalla iPhone 13', categoria: 'Repuestos', qty: 3, costo: 30, moneda: 'USD' },
  'reparaciones/rep-1': { userId: UID, num: 12, fecha, cliente: 'Cliente de prueba', clienteId: 'cliente-1', tel: '2235555555', equipo: 'iPhone 13', trabajo: 'Cambio de pantalla', precio: 100, sena: 20, saldo: 80, moneda: 'USD', tc: 1400, estado: 'recibido', repuestos: [{ refId: 'pantalla-1', origen: 'inv', nombre: 'Pantalla iPhone 13', qty: 1, costo: 30, moneda: 'USD' }], historial: [] },
  'clientes/cliente-1': { userId: UID, nombre: 'Cliente de prueba', tel: '2235555555' },
  'gastos/gasto-1': { userId: UID, fecha, tipo: 'negocio', concepto: 'Internet', categoria: 'Servicios', monto: 14000, usd: 10, moneda: 'ARS', medio: 'Efectivo', pagado: true },
  'consig/consig-1': { userId: UID, producto: 'iPhone 14', proveedor: 'Proveedor prueba', tipoProveedor: 'fijo', precioUSD: 300, precioVenta: 450, status: 'en_stock', fechaEntrada: fecha },
  'encargues/enc-1': { userId: UID, cliente: 'Cliente de prueba', producto: 'AirPods', precio: 100, sena: 30, moneda: 'USD', senaMedio: 'Efectivo', fechaEncargue: fecha, estado: 'pendiente', tc: 1400 },
  'gastos_fijos/fijo-1': { userId: UID, nombre: 'Alquiler', tipo: 'negocio', categoria: 'Servicios', importe: 100, moneda: 'USD', diaVenc: 10, alertaDias: 5, medio: 'Efectivo' },
}));
const suscripciones = new Set();
const autenticacion = { currentUser: null };
const authListeners = new Set();
const copiar = valor => structuredClone(valor);
export const initializeApp = config => ({ config });
export const initializeFirestore = app => ({ app });
export const getFirestore = initializeFirestore;
export const persistentLocalCache = () => ({});
export const getAuth = () => autenticacion;
export const serverTimestamp = () => ({ seconds: Date.now() / 1000 });
export const collection = (_db, nombre) => ({ path: nombre, coleccion: true });
export function doc(base, ...partes) { return { path: [base.path, ...partes].filter(Boolean).join('/') }; }
export const where = (campo, op, valor) => ({ tipo: 'where', campo, op, valor });
export const orderBy = (campo, orden = 'asc') => ({ tipo: 'orderBy', campo, orden });
export const limit = cantidad => ({ tipo: 'limit', cantidad });
export const query = (base, ...filtros) => ({ ...base, filtros });
const snapshotDoc = path => ({ id: path.split('/').at(-1), exists: () => docs.has(path), data: () => copiar(docs.get(path)) });
function seleccion(ref) {
  let filas = [...docs].filter(([path]) => path.startsWith(ref.path + '/') && path.split('/').length === ref.path.split('/').length + 1);
  for (const filtro of ref.filtros || []) {
    if (filtro.tipo === 'where') filas = filas.filter(([, d]) => filtro.op === '==' ? d[filtro.campo] === filtro.valor : filtro.op === '>=' ? d[filtro.campo] >= filtro.valor : d[filtro.campo] <= filtro.valor);
    if (filtro.tipo === 'orderBy') filas.sort((a, b) => String(a[1][filtro.campo]).localeCompare(String(b[1][filtro.campo])) * (filtro.orden === 'desc' ? -1 : 1));
    if (filtro.tipo === 'limit') filas = filas.slice(0, filtro.cantidad);
  }
  return filas.map(([path]) => snapshotDoc(path));
}
const snapshotQuery = ref => { const lista = seleccion(ref); return { docs: lista, size: lista.length, empty: !lista.length, forEach: fn => lista.forEach(fn), docChanges: () => lista.map(d => ({ type: 'added', doc: d })) }; };
export const getDoc = async ref => snapshotDoc(ref.path);
export const getDocs = async ref => snapshotQuery(ref);
export function onSnapshot(ref, callback) {
  const entrada = { ref, callback, previos: new Set() };
  suscripciones.add(entrada);
  queueMicrotask(() => emitir(entrada));
  return () => suscripciones.delete(entrada);
}
function emitir(entrada) {
  if (!entrada.ref.coleccion) { entrada.callback(snapshotDoc(entrada.ref.path)); return; }
  const snap = snapshotQuery(entrada.ref);
  const ids = new Set(snap.docs.map(d => d.id));
  const cambios = [...snap.docs.map(d => ({ type: entrada.previos.has(d.id) ? 'modified' : 'added', doc: d })), ...[...entrada.previos].filter(id => !ids.has(id)).map(id => ({ type: 'removed', doc: { id } }))];
  entrada.previos = ids;
  entrada.callback({ ...snap, docChanges: () => cambios });
}
function avisar(path) {
  for (const entrada of suscripciones) if (path === entrada.ref.path || path.startsWith(entrada.ref.path + '/')) queueMicrotask(() => emitir(entrada));
}
export async function setDoc(ref, datos, opciones = {}) { docs.set(ref.path, copiar(opciones.merge ? { ...docs.get(ref.path), ...datos } : datos)); avisar(ref.path); }
export async function updateDoc(ref, datos) { if (!docs.has(ref.path)) throw new Error('Documento inexistente.'); return setDoc(ref, datos, { merge: true }); }
export async function addDoc(ref, datos) { const nuevo = doc(ref, crypto.randomUUID()); await setDoc(nuevo, datos); return { ...nuevo, id: nuevo.path.split('/').at(-1) }; }
export async function deleteDoc(ref) { docs.delete(ref.path); avisar(ref.path); }
export function writeBatch() {
  const operaciones = [];
  return { set: (...a) => operaciones.push(() => setDoc(...a)), update: (...a) => operaciones.push(() => updateDoc(...a)), delete: (...a) => operaciones.push(() => deleteDoc(...a)), commit: async () => { for (const op of operaciones) await op(); } };
}
export function onAuthStateChanged(_auth, callback) { authListeners.add(callback); queueMicrotask(() => callback(autenticacion.currentUser)); return () => authListeners.delete(callback); }
export async function signInWithEmailAndPassword() {
  autenticacion.currentUser = { uid: UID, email: 'prueba@example.invalid', getIdToken: async () => 'token-ficticio' };
  for (const callback of authListeners) await callback(autenticacion.currentUser);
  return { user: autenticacion.currentUser };
}
export async function signOut() { autenticacion.currentUser = null; for (const callback of authListeners) await callback(null); }
window.__datosPrueba = { leer: path => copiar(docs.get(path)), listar: nombre => seleccion(collection(null, nombre)).map(d => ({ id: d.id, ...d.data() })), cargar: (path, datos) => setDoc({ path }, { userId: UID, ...datos }), fecha };
