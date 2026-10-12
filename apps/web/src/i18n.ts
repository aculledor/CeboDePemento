import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { phaseGl, phaseEs } from "./phase-translations";
// Editorial translations are explicit; only the interface language is persisted.
const gl = {
  catalog: "Especies",
  home: "Inicio",
  title: "Coñece o que tes diante.",
  intro: "Nomes, referencias e identificación para as túas xornadas de pesca.",
  search: "Nome común ou científico",
  all: "Todas",
  fish: "Peixes",
  cephalopod: "Cefalópodos",
  crustacean: "Crustáceos",
  loading: "Consultando o servidor…",
  offline:
    "Non se puido confirmar a conexión coa API. As accións están bloqueadas.",
  retry: "Comprobar conexión",
  empty: "Non hai resultados para esta busca.",
  selection: "Catálogo inicial",
  entries: "entradas",
  pending: "fóra da selección inicial",
  notice:
    "Entradas de referencia. Consulta as fontes e o estado de revisión de cada ficha; non é un inventario validado de fauna local.",
  previous: "Anterior",
  next: "Seguinte",
  back: "Volver",
  glName: "Nome en galego",
  esName: "Nome en castelán",
  reference: "Entrada de referencia",
  generic: "Identificación xenérica",
  online: "API conectada",
  phase: "Caderno de pesca · Galicia",
  nofoto: "Sen fotografía",
  names: "Nomes e alias",
  review: "Revisión pendente",
};
const es = {
  catalog: "Especies",
  home: "Inicio",
  title: "Conoce lo que tienes delante.",
  intro: "Nombres, referencias e identificación para tus jornadas de pesca.",
  search: "Nombre común o científico",
  all: "Todas",
  fish: "Peces",
  cephalopod: "Cefalópodos",
  crustacean: "Crustáceos",
  loading: "Consultando el servidor…",
  offline:
    "No se pudo confirmar la conexión con la API. Las acciones están bloqueadas.",
  retry: "Comprobar conexión",
  empty: "No hay resultados para esta búsqueda.",
  selection: "Catálogo inicial",
  entries: "entradas",
  pending: "fuera de la selección inicial",
  notice:
    "Entradas de referencia. Consulta las fuentes y el estado de revisión de cada ficha; no es un inventario validado de fauna local.",
  previous: "Anterior",
  next: "Siguiente",
  back: "Volver",
  glName: "Nombre en gallego",
  esName: "Nombre en castellano",
  reference: "Entrada de referencia",
  generic: "Identificación genérica",
  online: "API conectada",
  phase: "Cuaderno de pesca · Galicia",
  nofoto: "Sin fotografía",
  names: "Nombres y alias",
  review: "Revisión pendiente",
};
Object.assign(gl, {
  reviewCaptureSize:
    "Actualizar expresamente a referencia de talla desde a ficha actual.",
});
Object.assign(es, {
  reviewCaptureSize:
    "Actualizar expresamente la referencia de talla desde la ficha actual.",
});
Object.assign(gl, { historicalZone: "Zona histórica conservada" });
Object.assign(es, { historicalZone: "Zona histórica conservada" });
let language = "gl";
try {
  language = localStorage.getItem("language") === "es" ? "es" : "gl";
} catch {}
Object.assign(gl, phaseGl);
Object.assign(es, phaseEs);
Object.assign(gl, {
  sessions_profile: "Deste perfil",
  recordOrder: "Ordenar os récords por",
  speciesRecords: "Totais e récords por especie",
});
Object.assign(es, {
  sessions_profile: "De este perfil",
  recordOrder: "Ordenar los récords por",
  speciesRecords: "Totales y récords por especie",
});
Object.assign(gl, {
  error_RATE_LIMIT: "Demasiados intentos. Agarda un minuto e tenta de novo.",
});
Object.assign(es, {
  error_RATE_LIMIT:
    "Demasiados intentos. Espera un minuto e inténtalo de nuevo.",
});
Object.assign(gl, {
  deleteSession: "Eliminar sesión do caderno",
  deleteCapture: "Eliminar lote",
});
Object.assign(es, {
  deleteSession: "Eliminar sesión del cuaderno",
  deleteCapture: "Eliminar lote",
});
Object.assign(gl, {
  invalidField: "Revisa este campo.",
  catalogUpdated: "Ficha modificada",
  catalogCreated: "Ficha creada",
  capturePhoto: "Fotografía da captura",
  photo_approved: "Aprobada",
  photo_candidate: "Por revisar",
  photo_rejected: "Rexeitada",
  candidatesFound:
    "{{count}} candidatas con licenza recoñecida. Revisa cada arquivo antes de aprobalo.",
});
Object.assign(es, {
  invalidField: "Revisa este campo.",
  catalogUpdated: "Ficha modificada",
  catalogCreated: "Ficha creada",
  capturePhoto: "Fotografía de la captura",
  photo_approved: "Aprobada",
  photo_candidate: "Por revisar",
  photo_rejected: "Rechazada",
  candidatesFound:
    "{{count}} candidatas con licencia reconocida. Revisa cada archivo antes de aprobarlo.",
});
Object.assign(gl, {
  photos: "Fotografías",
  speciesPhoto: "Fotografía da ficha",
  photoCandidate: "Fotografía candidata",
  source: "Orixinal",
  photoAuthor: "Autor da fotografía",
  sourceUrl: "URL de procedencia (opcional para fotografía propia)",
  license: "Licenza",
  rightsConfirmed:
    "Comprobei a identificación e os dereitos de uso desta foto.",
  approvePhoto: "Aprobar e descargar",
  rejectPhoto: "Rexeitar / ocultar",
  mainPhoto: "Facer principal",
  uploadPhoto: "Subir fotografía",
  findCandidates: "Buscar candidatas",
  photoNotice:
    "JPEG, PNG ou WebP · máximo 8 MB. As copias publicadas eliminan EXIF/GPS. A aprobación conserva autoría e licenza.",
  error_IMAGE_TOO_LARGE: "A fotografía supera 8 MB.",
  error_IMAGE_TYPE: "Formato de imaxe non admitido.",
  error_IMAGE_SOURCE_UNAVAILABLE:
    "A fonte externa non está dispoñible. Podes utilizar a subida manual.",
  error_SCIENTIFIC_NAME_REQUIRED:
    "Introduce un nome científico antes de buscar fotografías.",
});
Object.assign(es, {
  photos: "Fotografías",
  speciesPhoto: "Fotografía de la ficha",
  photoCandidate: "Fotografía candidata",
  source: "Original",
  photoAuthor: "Autor de la fotografía",
  sourceUrl: "URL de procedencia (opcional para fotografía propia)",
  license: "Licencia",
  rightsConfirmed:
    "He comprobado la identificación y los derechos de uso de esta foto.",
  approvePhoto: "Aprobar y descargar",
  rejectPhoto: "Rechazar / ocultar",
  mainPhoto: "Hacer principal",
  uploadPhoto: "Subir fotografía",
  findCandidates: "Buscar candidatas",
  photoNotice:
    "JPEG, PNG o WebP · máximo 8 MB. Las copias publicadas eliminan EXIF/GPS. La aprobación conserva autoría y licencia.",
  error_IMAGE_TOO_LARGE: "La fotografía supera 8 MB.",
  error_IMAGE_TYPE: "Formato de imagen no admitido.",
  error_IMAGE_SOURCE_UNAVAILABLE:
    "La fuente externa no está disponible. Puedes utilizar la subida manual.",
  error_SCIENTIFIC_NAME_REQUIRED:
    "Introduce un nombre científico antes de buscar fotografías.",
});
Object.assign(gl, { sources: "Fontes de procedencia", member: "Membro" });
Object.assign(es, { sources: "Fuentes de procedencia", member: "Miembro" });
Object.assign(gl, {
  admin: "Administración",
  profile: "Perfil",
  welcome: "Boa pesca, {{name}}.",
  homeIntro: "O teu caderno compartido para pescar en Galicia.",
  openCatalog: "Explorar especies",
  reviewCatalog: "Un catálogo que medra contigo.",
  adminIntro:
    "Revisa as fichas antes de publicar, conserva os alias e documenta cada referencia.",
  invitations: "Invitacións de acceso",
  newInvitation: "Crear invitación · 72 horas",
  shareToken:
    "Entrega este código á persoa convidada ou á que recupera acceso. Gárdao agora; a lista non mostra os códigos.",
  recoveryToken: "Código de recuperación",
  used: "Utilizada",
  revoked: "Revogada",
  expires: "Caduca",
  createTaxon: "Crear ficha",
  editTaxon: "Editar ficha",
  visible: "Visible",
  hidden: "Oculta",
  editorNotice:
    "Os identificadores consérvanse. Ocultar unha ficha non elimina os seus datos históricos.",
  missingTranslation:
    "Se non coñeces un nome, elimina a fila baleira. A tradución ausente quedará explícita.",
  scientificName: "Nome científico",
  category: "Grupo biolóxico",
  identification: "Identificación",
  species_name: "Nome de especie",
  aggregate: "Categoría agregada",
  unresolved: "Sen identificar",
  reviewState: "Estado de revisión",
  reviewed: "Revisada",
  visibility: "Visibilidade",
  presence: "Estado de presenza local",
  language: "Idioma",
  name: "Nome",
  primaryName: "Nome principal",
  alias: "Alias",
  removeAlias: "Eliminar alias",
  addAlias: "Engadir alias",
  taxonomy: "Taxonomía",
  taxonomicClass: "Clase",
  taxonomicOrder: "Orde",
  family: "Familia",
  editorial: "Identificación e consellos",
  descriptionGl: "Descrición · galego",
  descriptionEs: "Descrición · castelán",
  tipsGl: "Consellos · galego",
  tipsEs: "Consellos · castelán",
  notes: "Observacións editoriais",
  sizeReference: "Talla de referencia",
  sizeNotice:
    "Referencia interna de competición, revisable. Os datos pendentes non significan ausencia de mínimo.",
  sizeState: "Revisión da talla",
  size_pending: "Pendente",
  size_has_minimum: "Ten valor de referencia",
  size_confirmed_no_minimum: "Confirmada sen mínimo",
  minimumCm: "Referencia en centímetros",
  minimumSource: "Fonte ou criterio da revisión",
  minimumReviewedAt: "Data de revisión",
  save: "Gardar no servidor",
  history: "Historial de modificacións",
  checkAliases: "Revisa nomes duplicados ou principais.",
  uncertain:
    "Non se confirmou o resultado. Os datos están bloqueados ata consultar esta operación no servidor.",
  reconcile: "Consultar resultado / reintentar",
  error_REVISION_CONFLICT:
    "A ficha cambiou desde que a abriches. Volve cargar antes de editar.",
  error_DUPLICATE_TAXON: "Xa existe unha ficha con ese nome científico.",
  error_PENDING_OPERATION:
    "Consulta a operación pendente antes de cambiar datos.",
  error_SERVER_UNAVAILABLE: "API sen conexión. Non se enviou a acción.",
  missing: "Tradución non dispoñible",
  tips: "Consellos",
  description: "Identificación",
  role: "Rol",
});
Object.assign(es, {
  admin: "Administración",
  profile: "Perfil",
  welcome: "Buena pesca, {{name}}.",
  homeIntro: "Tu cuaderno compartido para pescar en Galicia.",
  openCatalog: "Explorar especies",
  reviewCatalog: "Un catálogo que crece contigo.",
  adminIntro:
    "Revisa las fichas antes de publicar, conserva los alias y documenta cada referencia.",
  invitations: "Invitaciones de acceso",
  newInvitation: "Crear invitación · 72 horas",
  shareToken:
    "Entrega este código a la persona invitada o a quien recupera acceso. Guárdalo ahora; la lista no muestra los códigos.",
  recoveryToken: "Código de recuperación",
  used: "Utilizada",
  revoked: "Revocada",
  expires: "Caduca",
  createTaxon: "Crear ficha",
  editTaxon: "Editar ficha",
  visible: "Visible",
  hidden: "Oculta",
  editorNotice:
    "Los identificadores se conservan. Ocultar una ficha no elimina sus datos históricos.",
  missingTranslation:
    "Si no conoces un nombre, elimina la fila vacía. La traducción ausente quedará explícita.",
  scientificName: "Nombre científico",
  category: "Grupo biológico",
  identification: "Identificación",
  species_name: "Nombre de especie",
  aggregate: "Categoría agregada",
  unresolved: "Sin identificar",
  reviewState: "Estado de revisión",
  reviewed: "Revisada",
  visibility: "Visibilidad",
  presence: "Estado de presencia local",
  language: "Idioma",
  name: "Nombre",
  primaryName: "Nombre principal",
  alias: "Alias",
  removeAlias: "Eliminar alias",
  addAlias: "Añadir alias",
  taxonomy: "Taxonomía",
  taxonomicClass: "Clase",
  taxonomicOrder: "Orden",
  family: "Familia",
  editorial: "Identificación y consejos",
  descriptionGl: "Descripción · gallego",
  descriptionEs: "Descripción · castellano",
  tipsGl: "Consejos · gallego",
  tipsEs: "Consejos · castellano",
  notes: "Observaciones editoriales",
  sizeReference: "Talla de referencia",
  sizeNotice:
    "Referencia interna de competición, revisable. Los datos pendientes no significan ausencia de mínimo.",
  sizeState: "Revisión de talla",
  size_pending: "Pendiente",
  size_has_minimum: "Tiene valor de referencia",
  size_confirmed_no_minimum: "Confirmada sin mínimo",
  minimumCm: "Referencia en centímetros",
  minimumSource: "Fuente o criterio de la revisión",
  minimumReviewedAt: "Fecha de revisión",
  save: "Guardar en el servidor",
  history: "Historial de modificaciones",
  checkAliases: "Revisa nombres duplicados o principales.",
  uncertain:
    "No se confirmó el resultado. Los datos están bloqueados hasta consultar esta operación en el servidor.",
  reconcile: "Consultar resultado / reintentar",
  error_REVISION_CONFLICT:
    "La ficha cambió desde que la abriste. Recarga antes de editar.",
  error_DUPLICATE_TAXON: "Ya existe una ficha con ese nombre científico.",
  error_PENDING_OPERATION:
    "Consulta la operación pendiente antes de cambiar datos.",
  error_SERVER_UNAVAILABLE: "API sin conexión. No se envió la acción.",
  missing: "Traducción no disponible",
  tips: "Consejos",
  description: "Identificación",
  role: "Rol",
});
Object.assign(gl, {
  login: "Entrar",
  register: "Crear conta",
  reset: "Recuperar acceso",
  username: "Usuario",
  password: "Contrasinal",
  newPassword: "Novo contrasinal",
  displayName: "Nome visible",
  token: "Código entregado polo administrador",
  passwordHelp:
    "Usuario: 3–32 letras minúsculas, números, punto, guión ou _. Contrasinal: 12–128 caracteres.",
  authIntro: "Acceso privado para o teu grupo de pesca.",
  invalidForm: "Revisa os campos e a lonxitude do contrasinal.",
  saving: "Confirmando co servidor…",
  logout: "Saír",
  error_BAD_CREDENTIALS: "Usuario ou contrasinal incorrectos.",
  error_INVALID_TOKEN: "Código inválido, caducado ou xa utilizado.",
  error_USERNAME_TAKEN: "Ese usuario xa existe.",
  error_VALIDATION: "Revisa os datos do formulario.",
  error_CSRF: "A sesión de seguridade caducou. Tenta de novo.",
  error_ORIGIN_DENIED: "O enderezo desta web non está en APP_ORIGINS.",
  error_FORBIDDEN: "Non tes permiso para esta acción.",
  error_AUTH_REQUIRED: "Inicia sesión para continuar.",
  error_SERVER_ERROR: "Erro do servidor. Comproba a conexión.",
  error_IDEMPOTENCY_CONFLICT: "Esta operación xa se enviou con outros datos.",
});
Object.assign(es, {
  login: "Entrar",
  register: "Crear cuenta",
  reset: "Recuperar acceso",
  username: "Usuario",
  password: "Contraseña",
  newPassword: "Nueva contraseña",
  displayName: "Nombre visible",
  token: "Código entregado por el administrador",
  passwordHelp:
    "Usuario: 3–32 letras minúsculas, números, punto, guion o _. Contraseña: 12–128 caracteres.",
  authIntro: "Acceso privado para tu grupo de pesca.",
  invalidForm: "Revisa los campos y la longitud de la contraseña.",
  saving: "Confirmando con el servidor…",
  logout: "Salir",
  error_BAD_CREDENTIALS: "Usuario o contraseña incorrectos.",
  error_INVALID_TOKEN: "Código inválido, caducado o ya utilizado.",
  error_USERNAME_TAKEN: "Ese usuario ya existe.",
  error_VALIDATION: "Revisa los datos del formulario.",
  error_CSRF: "La sesión de seguridad ha caducado. Inténtalo de nuevo.",
  error_ORIGIN_DENIED: "La dirección de esta web no está en APP_ORIGINS.",
  error_FORBIDDEN: "No tienes permiso para esta acción.",
  error_AUTH_REQUIRED: "Inicia sesión para continuar.",
  error_SERVER_ERROR: "Error del servidor. Comprueba la conexión.",
  error_IDEMPOTENCY_CONFLICT: "Esta operación ya se envió con otros datos.",
});
document.documentElement.lang = language;
void i18n.use(initReactI18next).init({
  resources: { gl: { translation: gl }, es: { translation: es } },
  lng: language,
  fallbackLng: "gl",
  interpolation: { escapeValue: false },
});
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem("language", lng);
  } catch {}
});
export default i18n;
