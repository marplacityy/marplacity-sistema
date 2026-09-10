import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import QRious from 'qrious';

// Conserva la API usada por las facturas y órdenes, con versiones fijadas en npm.
applyPlugin(jsPDF);
window.jspdf = { jsPDF };
window.QRious = QRious;
