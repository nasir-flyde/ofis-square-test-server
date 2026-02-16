import { SendMailClient } from "zeptomail";

class ZeptoMailProvider {
  constructor() {
    this.name = 'zeptomail';
    this.client = new SendMailClient({
      url: process.env.ZEPTOMAIL_URL || "https://api.zeptomail.in/v1.1/email",
      token: process.env.ZEPTOMAIL_TOKEN,
    });
    this.fromAddress = process.env.ZEPTOMAIL_FROM_ADDRESS || "hello@ofisspaces.com";
    this.fromName = process.env.ZEPTOMAIL_FROM_NAME || "Ofis Square";
  }

  async send(options) {
    const { toEmail, subject, html, text } = options;
    try {
      console.log(`[ZeptoMailProvider:send] Sending to ${toEmail} with ${options.attachments?.length || 0} attachments`);

      if (!process.env.ZEPTOMAIL_TOKEN) {
        throw new Error('ZeptoMail token not configured');
      }

      const mailPayload = {
        "from": {
          "address": this.fromAddress,
          "name": this.fromName
        },
        "to": [
          {
            "email_address": {
              "address": toEmail
            }
          }
        ],
        "subject": subject,
        "htmlbody": html || (text ? text.replace(/\n/g, '<br/>') : 'No content')
      };

      if (options.attachments && options.attachments.length > 0) {
        mailPayload.attachments = options.attachments.map(att => ({
          content: att.content.toString('base64'),
          mime_type: att.contentType || 'application/pdf',
          name: att.filename
        }));
      }

      const result = await this.client.sendMail(mailPayload);

      return {
        success: true,
        providerMessageId: result?.data?.[0]?.messageId || 'zepto-sent',
        providerResponse: result
      };
    } catch (error) {
      console.error('ZeptoMail Provider Error:', error);
      return {
        success: false,
        error: error.message,
        errorCode: 'ZEPTO_ERROR',
        providerResponse: error
      };
    }
  }

  async verifyConnection() {
    return { success: true };
  }

  stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

// Mock provider for testing
class MockEmailProvider {
  constructor() {
    this.name = 'mock';
  }

  async send({ toEmail, subject, html, text }) {
    console.log(`[MOCK EMAIL] To: ${toEmail}, Subject: ${subject}`);
    console.log(`[MOCK EMAIL] Content: ${text || html}`);
    const success = Math.random() > 0.05;

    if (success) {
      return {
        success: true,
        providerMessageId: `mock_email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        providerResponse: { status: 'sent', mock: true }
      };
    } else {
      return {
        success: false,
        error: 'Mock email failure for testing',
        errorCode: 'MOCK_ERROR',
        providerResponse: { status: 'failed', mock: true }
      };
    }
  }

  async verifyConnection() {
    return { success: true, mock: true };
  }
}

export const getEmailProvider = () => {
  const useMock = process.env.NODE_ENV === 'test' || process.env.USE_MOCK_EMAIL === 'true';
  if (useMock) return new MockEmailProvider();

  return new ZeptoMailProvider();
};

export { ZeptoMailProvider, MockEmailProvider };
