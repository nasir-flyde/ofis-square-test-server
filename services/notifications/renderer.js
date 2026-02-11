// Simple template renderer for notifications
class NotificationRenderer {
  constructor() {
    this.templates = {
      // System templates
      welcome_email: {
        subject: 'Welcome to {{companyName}}!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome {{name}}!</h2>
            <p>Thank you for joining {{companyName}}. We're excited to have you on board.</p>
            <p>Your account has been successfully created and you can now access our services.</p>
            <p>If you have any questions, feel free to reach out to our support team.</p>
            <p>Best regards,<br>The {{companyName}} Team</p>
          </div>
        `,
        text: 'Welcome {{name}}! Thank you for joining {{companyName}}. Your account has been successfully created.'
      },

      booking_confirmation: {
        subject: 'Booking Confirmation - {{bookingId}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Booking Confirmed</h2>
            <p>Hi {{name}},</p>
            <p>Your booking has been confirmed with the following details:</p>
            <ul>
              <li><strong>Booking ID:</strong> {{bookingId}}</li>
              <li><strong>Date:</strong> {{date}}</li>
              <li><strong>Time:</strong> {{time}}</li>
              <li><strong>Location:</strong> {{location}}</li>
            </ul>
            <p>Thank you for choosing our services!</p>
          </div>
        `,
        text: 'Hi {{name}}, your booking {{bookingId}} has been confirmed for {{date}} at {{time}}.',
        sms: 'Hi {{name}}, your booking {{bookingId}} is confirmed for {{date}} at {{time}}. Location: {{location}}'
      },

      payment_reminder: {
        subject: 'Payment Reminder - Invoice {{invoiceNumber}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Payment Reminder</h2>
            <p>Hi {{name}},</p>
            <p>This is a friendly reminder that your payment is due.</p>
            <ul>
              <li><strong>Invoice:</strong> {{invoiceNumber}}</li>
              <li><strong>Amount:</strong> ₹{{amount}}</li>
              <li><strong>Due Date:</strong> {{dueDate}}</li>
            </ul>
            <p>Please make your payment at your earliest convenience.</p>
          </div>
        `,
        text: 'Payment reminder: Invoice {{invoiceNumber}} for ₹{{amount}} is due on {{dueDate}}.',
        sms: 'Payment reminder: Invoice {{invoiceNumber}} for ₹{{amount}} is due on {{dueDate}}. Please pay soon.'
      },

      otp_verification: {
        subject: 'Your OTP Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Verification Code</h2>
            <p>Your OTP code is: <strong style="font-size: 24px; color: #007bff;">{{otp}}</strong></p>
            <p>This code will expire in {{expiryMinutes}} minutes.</p>
            <p>If you didn't request this code, please ignore this message.</p>
          </div>
        `,
        text: 'Your OTP code is: {{otp}}. Valid for {{expiryMinutes}} minutes.',
        sms: 'Your OTP code is {{otp}}. Valid for {{expiryMinutes}} minutes. Do not share with anyone.'
      }
    };
  }

  renderTemplate(templateKey, variables = {}) {
    const template = this.templates[templateKey];
    if (!template) {
      throw new Error(`Template '${templateKey}' not found`);
    }

    const rendered = {
      subject: this.interpolate(template.subject, variables),
      html: this.interpolate(template.html, variables),
      text: this.interpolate(template.text, variables)
    };

    // Use SMS-specific template if available, otherwise use text
    if (template.sms) {
      rendered.sms = this.interpolate(template.sms, variables);
    } else {
      rendered.sms = rendered.text;
    }

    return rendered;
  }

  renderContent(content, variables = {}) {
    const rendered = {};

    if (content.smsText) {
      rendered.smsText = this.interpolate(content.smsText, variables);
    }

    if (content.emailSubject) {
      rendered.emailSubject = this.interpolate(content.emailSubject, variables);
    }

    if (content.emailHtml) {
      rendered.emailHtml = this.interpolate(content.emailHtml, variables);
    }

    if (content.emailText) {
      rendered.emailText = this.interpolate(content.emailText, variables);
    }

    return rendered;
  }

  interpolate(template, variables) {
    if (!template) return '';

    // Handle {{#if key}}...{{/if}} or {#if key}...{/if}
    let processed = template.replace(/\{{1,2}#if\s+([^{}]+?)\s*\}{1,2}([\s\S]*?)\{{1,2}\/if\s*\}{1,2}/g, (match, key, content) => {
      const trimmedKey = key.trim();
      return variables[trimmedKey] ? content : '';
    });

    // Handle {{key}} or {key} with support for spaces and special characters in keys
    // This regex matches things like {{greeting}}, {Member Name}, {{ Category }}
    return processed.replace(/\{{1,2}\s*([^{}]+?)\s*\}{1,2}/g, (match, key) => {
      const trimmedKey = key.trim();
      // Try exact match first
      if (variables[trimmedKey] !== undefined) {
        return variables[trimmedKey];
      }
      // Try case-insensitive match if exact match fails
      const lowerKey = trimmedKey.toLowerCase();
      const foundKey = Object.keys(variables).find(k => k.toLowerCase() === lowerKey);
      if (foundKey && variables[foundKey] !== undefined) {
        return variables[foundKey];
      }
      return match;
    });
  }

  addTemplate(key, template) {
    this.templates[key] = template;
  }

  getTemplate(key) {
    return this.templates[key];
  }

  listTemplates() {
    return Object.keys(this.templates);
  }
}

// Singleton instance
const renderer = new NotificationRenderer();

export default renderer;
export { NotificationRenderer };
