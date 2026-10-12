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
