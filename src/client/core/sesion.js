/** core/sesion: lógica preservada de la aplicación original. */
import { contextoApp } from './estado.js';
import { onAuthStateChanged } from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { init } from './datos.js';

export function inicializarSesion() {
  onAuthStateChanged(contextoApp.auth, async user => {
    const loginScreen = document.getElementById('login-screen');
    const loadingEl = document.getElementById('loading');
    if (user) {
      contextoApp.currentUser = user;
      contextoApp.uid = user.uid;
      contextoApp.cfgDoc = doc(contextoApp.db, 'config', contextoApp.uid);
      contextoApp.conocDoc = doc(contextoApp.db, 'conocimiento', contextoApp.uid);
      loginScreen.classList.remove('show');
      loadingEl.classList.remove('hidden');
      document.getElementById('user-email').textContent = user.email;
      await init();
      window.goTo('home');
    } else {
      contextoApp.currentUser = null;
      contextoApp.uid = null;
      contextoApp.cfgDoc = null;
      contextoApp.conocDoc = null;
      loadingEl.classList.add('hidden');
      loginScreen.classList.add('show');
    }
  });
  document.getElementById('login-pass').addEventListener('keydown', e => {
    if (e.key === 'Enter') window.doLogin();
  });
  document.getElementById('login-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') window.doLogin();
  });
}
