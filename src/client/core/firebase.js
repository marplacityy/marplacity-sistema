/** core/firebase: lógica preservada de la aplicación original. */
import { contextoApp } from './estado.js';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

export function inicializarFirebase() {
  contextoApp.firebaseConfig = {
    apiKey: "AIzaSyCxT-g9yMRhrRcjwI5uz3ITTWUB8ddeZCg",
    authDomain: "mis-gastos-21e7b.firebaseapp.com",
    projectId: "mis-gastos-21e7b",
    storageBucket: "mis-gastos-21e7b.firebasestorage.app",
    messagingSenderId: "482988396081",
    appId: "1:482988396081:web:fc7da9caf6a51d2e00cf10"
  };
  contextoApp.app = initializeApp(contextoApp.firebaseConfig);
  try {
    contextoApp.db = initializeFirestore(contextoApp.app, {
      localCache: persistentLocalCache()
    });
    window._cachePersistente = true;
  } catch (e) {
    console.warn('Cache persistente no disponible, usando memoria:', e);
    contextoApp.db = initializeFirestore(contextoApp.app, {});
    window._cachePersistente = false;
  }
  contextoApp.auth = getAuth(contextoApp.app); // Snapshots incrementales: mantiene un Map por colección y aplica solo los cambios,
  // en vez de re-deserializar miles de documentos ante cada update
}
