// Prüft, dass die Oberflächen nur logische Tailwind-Klassen nutzen (ADR 0010). Physische Klassen wie
// ml-4 oder text-left wären in einer der beiden Leserichtungen falsch. Geprüft werden nur Klassen in
// className-Attributen, nicht Fließtext. Grenze: Klassen aus Ausdrücken wie
// className={a ? "x" : "y"} oder Hilfsfunktionen sieht die Prüfung nicht; dafür gilt das Review.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/web/src', 'apps/portal/src'];
const CLASS_ATTRIBUTE = /className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
const PHYSICAL = [
  /^-?(?:m|p|scroll-m|scroll-p)[lr]-/,
  /^-?(?:left|right)-/,
  /^border-[lr](?:-|$)/,
  /^rounded-(?:[lr]|[tb][lr])(?:-|$)/,
  /^text-(?:left|right)$/,
  /^float-(?:left|right)$/,
  /^clear-(?:left|right)$/,
];

function* files(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) yield path;
  }
}

const findings = [];
for (const root of ROOTS) {
  for (const file of files(root)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(CLASS_ATTRIBUTE)) {
      const classes = (match[1] ?? match[2] ?? match[3] ?? '').split(/\s+/);
      for (const name of classes) {
        // Varianten wie md: oder hover: und das Wichtig-Zeichen abschneiden.
        const utility = name.split(':').at(-1)?.replace(/^!/, '') ?? '';
        if (PHYSICAL.some((pattern) => pattern.test(utility))) {
          const line = source.slice(0, match.index).split('\n').length;
          findings.push(`${file}:${line}: ${name}`);
        }
      }
    }
  }
}

// Wie die übrigen CLI-Skripte über process.stdout/stderr statt console (Lint-Regel no-console).
if (findings.length > 0) {
  process.stderr.write(
    'Physische Klassen gefunden; bitte logische verwenden (ms-, me-, ps-, pe-, start-, end-, text-start):\n',
  );
  for (const finding of findings) process.stderr.write(`  ${finding}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Nur logische Klassen gefunden.\n');
}
