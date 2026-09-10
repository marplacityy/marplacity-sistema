/** Estado compartido de la sesión. Se inicializa en orden antes de escuchar el login.
 * Los módulos de dominio usan referencias explícitas para evitar copias desactualizadas.
 * No se guarda información del negocio en localStorage. */
export const contextoApp = {};
