import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";

// Mismo proyecto que index.html. La lectura de un doc de `docs_publicos` está
// abierta por reglas (allow get), pero NO se puede listar la colección: sin el
// token del link no hay forma de llegar a ningún documento.
const app = initializeApp({
  apiKey: "AIzaSyCxT-g9yMRhrRcjwI5uz3ITTWUB8ddeZCg",
  authDomain: "mis-gastos-21e7b.firebaseapp.com",
  projectId: "mis-gastos-21e7b",
  storageBucket: "mis-gastos-21e7b.firebasestorage.app",
  messagingSenderId: "482988396081",
  appId: "1:482988396081:web:fc7da9caf6a51d2e00cf10"
});
const db = getFirestore(app);

const $ = id => document.getElementById(id);

function fallar(titulo, detalle){
  $('cargando').hidden = true;
  $('ok').hidden = true;
  $('error').hidden = false;
  $('err-t').textContent = titulo;
  $('err-d').textContent = detalle;
}

function b64ToBlob(b64, tipo){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0; i<bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {type: tipo});
}

// Fecha ISO (aaaa-mm-dd) → texto legible, sin que el parseo la corra un día
function fechaLinda(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso||'');
  if(!m) return iso||'';
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio',
                 'agosto','septiembre','octubre','noviembre','diciembre'];
  return `${+m[3]} de ${meses[+m[2]-1]} de ${m[1]}`;
}

(async function(){
  const token = new URLSearchParams(location.search).get('id') || '';
  if(!/^[A-Za-z0-9_-]{16,64}$/.test(token)){
    fallar('Link inválido', 'El enlace está incompleto o mal copiado. Pedile al local que te lo reenvíe.');
    return;
  }

  let snap;
  try{
    snap = await getDoc(doc(db, 'docs_publicos', token));
  }catch(e){
    console.error(e);
    fallar('No pudimos abrir el documento', 'Revisá tu conexión a internet y volvé a intentar.');
    return;
  }

  if(!snap.exists()){
    fallar('Este link ya no está disponible', 'El documento fue dado de baja. Pedile al local que te lo reenvíe.');
    return;
  }

  const d = snap.data();
  if(!d.pdf){
    fallar('No pudimos abrir el documento', 'El archivo está incompleto. Pedile al local que te lo reenvíe.');
    return;
  }

  let url;
  try{
    url = URL.createObjectURL(b64ToBlob(d.pdf, 'application/pdf'));
  }catch(e){
    console.error(e);
    fallar('No pudimos abrir el documento', 'El archivo está dañado. Pedile al local que te lo reenvíe.');
    return;
  }

  const archivo = d.archivo || 'documento.pdf';
  document.title = d.titulo || 'Documento';
  $('d-local').textContent  = d.local || '';
  $('d-titulo').textContent = d.titulo || 'Documento';
  $('d-meta').textContent   = [d.cliente, fechaLinda(d.fecha)].filter(Boolean).join(' · ');
  $('d-bajar').href = url;
  $('d-bajar').setAttribute('download', archivo);
  $('d-abrir').href = url;
  $('d-frame').src  = url;
  $('d-visor').classList.add('ok');
  $('d-pie').textContent = (d.local ? d.local + ' · ' : '') + 'Guardá este PDF, es tu comprobante.';

  $('cargando').hidden = true;
  $('ok').hidden = false;
})();
