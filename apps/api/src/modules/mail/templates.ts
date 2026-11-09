import type { CompanyRole, Locale } from '@masar/shared';

interface Mail {
  subject: string;
  text: string;
}

const ROLE_NAMES: Record<Locale, Record<CompanyRole, string>> = {
  ar: { ADMIN: 'مدير', AGENT: 'موظف حجوزات', DRIVER: 'سائق' },
  en: { ADMIN: 'administrator', AGENT: 'booking agent', DRIVER: 'driver' },
};

/** Einladung in eine Firma. Der Link steht auf einer eigenen Zeile, damit RTL ihn nicht zerreißt. */
export function invitationMail(input: {
  locale: Locale;
  companyName: string;
  role: CompanyRole;
  link: string;
  validHours: number;
}): Mail {
  const role = ROLE_NAMES[input.locale][input.role];
  if (input.locale === 'ar') {
    return {
      subject: `دعوة للانضمام إلى ${input.companyName} على مسار`,
      text: [
        `تمت دعوتك للانضمام إلى ${input.companyName} على منصة مسار بصفة ${role}.`,
        '',
        'لقبول الدعوة افتح الرابط التالي:',
        input.link,
        '',
        `الرابط صالح لمدة ${input.validHours} ساعة. إذا لم تكن تتوقع هذه الدعوة فتجاهل هذه الرسالة.`,
      ].join('\n'),
    };
  }
  return {
    subject: `Invitation to join ${input.companyName} on Masar`,
    text: [
      `You have been invited to join ${input.companyName} on Masar as ${role}.`,
      '',
      'To accept the invitation, open this link:',
      input.link,
      '',
      `The link is valid for ${input.validHours} hours. If you did not expect this invitation, ignore this message.`,
    ].join('\n'),
  };
}

export function passwordResetMail(input: {
  locale: Locale;
  link: string;
  validMinutes: number;
}): Mail {
  if (input.locale === 'ar') {
    return {
      subject: 'إعادة تعيين كلمة المرور في مسار',
      text: [
        'لإعادة تعيين كلمة المرور افتح الرابط التالي:',
        input.link,
        '',
        `الرابط صالح لمدة ${input.validMinutes} دقيقة. إذا لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة المرور الحالية تبقى كما هي.`,
      ].join('\n'),
    };
  }
  return {
    subject: 'Reset your Masar password',
    text: [
      'To reset your password, open this link:',
      input.link,
      '',
      `The link is valid for ${input.validMinutes} minutes. If you did not request this, ignore this message; your password stays unchanged.`,
    ].join('\n'),
  };
}

/**
 * Inhalt einer Buchungsnachricht. Werte sind bereits formatiert (Ortszeit Damaskus, westliche
 * Ziffern); der Buchungscode steht in zwei Vierergruppen. Die Nachricht geht nur an die Adresse der
 * Buchung und landet nie im Log.
 */
export interface BookingMailInput {
  locale: Locale;
  companyName: string;
  bookingCode: string;
  departure: string;
  route: string;
  total: string;
  seats: string;
}

export type BookingMailKind = 'RESERVED' | 'CONFIRMED' | 'CANCELLED';

const BOOKING_MAIL: Record<
  Locale,
  Record<BookingMailKind, (input: BookingMailInput & { deadline: string }) => Mail>
> = {
  ar: {
    RESERVED: (input) => ({
      subject: `حجزك ${input.bookingCode} لدى ${input.companyName}`,
      text: [
        `تم حجز المقاعد ${input.seats} على رحلة ${input.route}.`,
        `موعد الانطلاق: ${input.departure}`,
        `المبلغ: ${input.total}، يُدفع نقداً في مكتب الشركة.`,
        `يرجى الدفع قبل: ${input.deadline}، وإلا يُلغى الحجز تلقائياً.`,
        '',
        'رمز الحجز:',
        input.bookingCode,
      ].join('\n'),
    }),
    CONFIRMED: (input) => ({
      subject: `تأكيد الحجز ${input.bookingCode} لدى ${input.companyName}`,
      text: [
        `تم تأكيد حجزك للمقاعد ${input.seats} على رحلة ${input.route}.`,
        `موعد الانطلاق: ${input.departure}`,
        `المبلغ المدفوع: ${input.total}`,
        '',
        'رمز الحجز:',
        input.bookingCode,
      ].join('\n'),
    }),
    CANCELLED: (input) => ({
      subject: `إلغاء الحجز ${input.bookingCode} لدى ${input.companyName}`,
      text: [
        `تم إلغاء حجزك للمقاعد ${input.seats} على رحلة ${input.route} (${input.departure}).`,
        'إذا لم تطلب الإلغاء فتواصل مع الشركة.',
        '',
        'رمز الحجز:',
        input.bookingCode,
      ].join('\n'),
    }),
  },
  en: {
    RESERVED: (input) => ({
      subject: `Your booking ${input.bookingCode} with ${input.companyName}`,
      text: [
        `Seats ${input.seats} are reserved on ${input.route}.`,
        `Departure: ${input.departure}`,
        `Amount: ${input.total}, payable in cash at the company office.`,
        `Please pay before ${input.deadline}, otherwise the reservation is released automatically.`,
        '',
        'Booking code:',
        input.bookingCode,
      ].join('\n'),
    }),
    CONFIRMED: (input) => ({
      subject: `Booking ${input.bookingCode} with ${input.companyName} confirmed`,
      text: [
        `Your booking for seats ${input.seats} on ${input.route} is confirmed.`,
        `Departure: ${input.departure}`,
        `Amount paid: ${input.total}`,
        '',
        'Booking code:',
        input.bookingCode,
      ].join('\n'),
    }),
    CANCELLED: (input) => ({
      subject: `Booking ${input.bookingCode} with ${input.companyName} cancelled`,
      text: [
        `Your booking for seats ${input.seats} on ${input.route} (${input.departure}) is cancelled.`,
        'If you did not ask for this, please contact the company.',
        '',
        'Booking code:',
        input.bookingCode,
      ].join('\n'),
    }),
  },
};

export function bookingMail(
  kind: BookingMailKind,
  input: BookingMailInput & { deadline: string },
): Mail {
  return BOOKING_MAIL[input.locale][kind](input);
}
