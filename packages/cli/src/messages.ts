export type Lang = "es" | "en";

const es = {
  gatePassed: "APROBADO",
  gateFailed: "RECHAZADO",
  level: "Nivel",
  policy: "política",
  conversation: "conversación",
  passed: "ok",
  failed: "falló",
  skipped: "omitido (usá --model para simular conversaciones)",
  score: "Puntaje",
  failures: "Fallas",
  noPack: (what: string) => `No encontré el pack "${what}" (ni como id integrado ni como directorio).`,
  packOk: (id: string, scenarios: number, rules: number) => `Pack "${id}" válido: ${rules} reglas, ${scenarios} escenarios.`,
  initDone: (dir: string, id: string) => `Pack "${id}" creado en ${dir}. Editá pack.yaml, policies.yaml y scenarios/, y probalo con: ofd eval ${dir}`,
  initExists: (dir: string) => `${dir} ya existe y no está vacío.`,
  initBadId: (id: string) => `El nombre de directorio "${id}" no sirve como id de pack (solo minúsculas, números y guiones).`,
  migrated: "Migraciones aplicadas.",
  migrateHint: "Siguiente paso: `ofd seed` carga datos de demostración. Las tablas de autenticación las maneja la API.",
  seeded: (c: number, o: number, d: number) => `Datos de demo cargados: ${c} contactos, ${o} obligaciones, ${d} documentos.`,
  needDb: "Falta DATABASE_URL.",
  packsHeader: "ID\tVERSIÓN\tESCENARIOS\tNOMBRE",
};

const en: typeof es = {
  gatePassed: "PASSED",
  gateFailed: "REJECTED",
  level: "Level",
  policy: "policy",
  conversation: "conversation",
  passed: "ok",
  failed: "failed",
  skipped: "skipped (use --model to simulate conversations)",
  score: "Score",
  failures: "Failures",
  noPack: (what: string) => `Pack "${what}" not found (neither a builtin id nor a directory).`,
  packOk: (id: string, scenarios: number, rules: number) => `Pack "${id}" is valid: ${rules} rules, ${scenarios} scenarios.`,
  initDone: (dir: string, id: string) => `Pack "${id}" created in ${dir}. Edit pack.yaml, policies.yaml and scenarios/, then try: ofd eval ${dir}`,
  initExists: (dir: string) => `${dir} already exists and is not empty.`,
  initBadId: (id: string) => `The directory name "${id}" is not a valid pack id (lowercase letters, digits and dashes only).`,
  migrated: "Migrations applied.",
  migrateHint: "Next: `ofd seed` loads demo data. Auth tables are managed by the API.",
  seeded: (c: number, o: number, d: number) => `Demo data loaded: ${c} contacts, ${o} obligations, ${d} documents.`,
  needDb: "DATABASE_URL is required.",
  packsHeader: "ID\tVERSION\tSCENARIOS\tNAME",
};

export const messages = (lang: Lang) => (lang === "en" ? en : es);
