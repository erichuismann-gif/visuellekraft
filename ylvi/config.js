// Zugangsdaten für die gemeinsame Supabase-Datenbank.
//
// Solange beide Werte leer sind, läuft die App im LOKALEN MODUS:
// Alles wird nur auf dem jeweiligen Handy gespeichert.
// Nach dem Eintragen der Werte bietet die App an, die lokalen Einträge
// (inkl. Fotos) in die gemeinsame Datenbank zu übernehmen.
//
// Zu finden im Supabase-Dashboard unter: Project Settings → API (bzw. "API Keys").
// Der "anon"/"publishable" Schlüssel darf öffentlich sein – geschützt wird über
// die Anmeldung und die Regeln aus supabase-setup.sql.
window.YLVI_CONFIG = {
  supabaseUrl: '',      // z. B. 'https://abcdefgh.supabase.co'
  supabaseAnonKey: '',  // z. B. 'sb_publishable_…' oder 'eyJhbGciOi…'
};
