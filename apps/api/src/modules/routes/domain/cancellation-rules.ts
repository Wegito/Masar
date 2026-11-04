/**
 * Stufen einer Stornoregel (Schritt 2.3, ADR 0026). Eine Stufe gilt ab
 * `minMinutesBeforeDeparture` Minuten vor Abfahrt; maßgeblich ist die größte erreichte Stufe
 * (`cancellationFeeBps` im Buchungsmodul). Reine Funktion.
 *
 * Regeln: Jede Schwelle nur einmal, und je näher die Abfahrt, desto höher oder gleich die Gebühr.
 * Eine Regel, die kurz vor Abfahrt billiger storniert als früh, lädt zum Warten ein und blockiert
 * Sitze bis zuletzt.
 */

export interface CancellationRuleInput {
  minMinutesBeforeDeparture: number;
  feeBps: number;
}

export function cancellationRulesIssue(
  rules: readonly CancellationRuleInput[],
): 'CANCELLATION_RULES_INVALID' | null {
  const thresholds = new Set(rules.map((rule) => rule.minMinutesBeforeDeparture));
  if (thresholds.size !== rules.length) {
    return 'CANCELLATION_RULES_INVALID';
  }
  const byDistance = [...rules].sort(
    (a, b) => b.minMinutesBeforeDeparture - a.minMinutesBeforeDeparture,
  );
  for (let index = 1; index < byDistance.length; index += 1) {
    if ((byDistance[index]?.feeBps ?? 0) < (byDistance[index - 1]?.feeBps ?? 0)) {
      return 'CANCELLATION_RULES_INVALID';
    }
  }
  return null;
}
