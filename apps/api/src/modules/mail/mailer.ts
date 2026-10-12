/** Eine Nachricht ohne HTML: Klartext kommt in jedem Postfach an und ist schwer zu fälschen. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Versand von E-Mails. Die abstrakte Klasse dient als DI-Token, damit Tests einen Fake einsetzen
 * und später weitere Kanäle (Outbox, Anbieter-API) dieselbe Schnittstelle erfüllen.
 */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}
