// Lint-Konfiguration nur für Dateien im Repo-Wurzelverzeichnis.
// Jeder Workspace hat eine eigene eslint.config.js (ESLint 10 sucht ab der Datei).
import { base } from '@masar/config/eslint';

export default base({ tsconfigRootDir: import.meta.dirname });
