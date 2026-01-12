import NotificationTemplate from "../../models/notificationTemplateModel.js";
import renderer from "./renderer.js";

/**
 * Render a string template by interpolating {{var}} placeholders
 * Uses renderer.interpolate implementation for consistency
 */
function interpolate(str, variables) {
  return renderer.interpolate(str, variables);
}

/**
 * Get an active template by key
 */
export async function getTemplateByKey(key) {
  if (!key) return null;
  const tpl = await NotificationTemplate.findOne({ key, isActive: true });
  return tpl;
}

/**
 * Render a DB template's content with variables.
 * Returns object: { subject, html, text, sms }
 */
export function renderDBTemplateContent(templateDoc, variables = {}) {
  const content = templateDoc?.content || {};
  const rendered = {
    subject: content.emailSubject ? interpolate(content.emailSubject, variables) : undefined,
    html: content.emailHtml ? interpolate(content.emailHtml, variables) : undefined,
    text: content.emailText ? interpolate(content.emailText, variables) : undefined,
    sms: content.sms ? interpolate(content.sms, variables) : undefined,
  };

  // Fallbacks if some email fields are missing
  if (!rendered.text && rendered.html) {
    // crude strip of HTML tags if text not provided
    rendered.text = rendered.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (!rendered.sms && rendered.text) {
    rendered.sms = rendered.text;
  }

  return rendered;
}

/**
 * Render a template by key, preferring DB template if available; fallback to in-memory renderer
 * Returns object: { subject, html, text, sms }
 */
export async function renderTemplateByKey(key, variables = {}) {
  const tpl = await getTemplateByKey(key);
  if (tpl) {
    return renderDBTemplateContent(tpl, variables);
  }
  // Fallback to in-memory renderer templates
  return renderer.renderTemplate(key, variables);
}

/**
 * Render arbitrary content object like in Notification creation content
 * Input: { smsText, emailSubject, emailHtml, emailText }
 * Output: { smsText, emailSubject, emailHtml, emailText }
 */
export function renderArbitraryContent(content, variables = {}) {
  return renderer.renderContent(content, variables);
}
