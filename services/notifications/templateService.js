import NotificationTemplate from "../../models/notificationTemplateModel.js";
import renderer from "./renderer.js";

function interpolate(str, variables) {
  return renderer.interpolate(str, variables);
}

export async function getTemplateByKey(key) {
  if (!key) return null;
  const tpl = await NotificationTemplate.findOne({ key, isActive: true }).populate("templateDesignId");
  return tpl;
}

export function renderDBTemplateContent(templateDoc, variables = {}) {
  const content = templateDoc?.content || {};
  let emailHtml = content.emailHtml
    ? interpolate(content.emailHtml, variables).replace(/\\n/g, '<br/>').replace(/\n/g, '<br/>')
    : (content.emailText ? interpolate(content.emailText, variables).replace(/\\n/g, '<br/>').replace(/\n/g, '<br/>') : undefined);

  if (templateDoc.templateDesignId && templateDoc.templateDesignId.html) {
    const design = templateDoc.templateDesignId;
    const bodyHtml = emailHtml || "";

    const renderedSubject = content.emailSubject ? interpolate(content.emailSubject, variables) : "";

    // Merge content fields into variables for the design (e.g. {{ctaText}})
    const designVariables = {
      ...variables,
      // User says greetings will be company name - map memberName to companyName if available
      memberName: variables.companyName || variables.memberName,
      brandName: process.env.BRAND_NAME || "OFIS SQUARE",
      logoUrl: design.logoUrl || undefined,
      logoUrlDark: design.logoUrlDark || undefined,
      ctaText: content.buttonText,
      ctaLink: content.buttonLink,
      subject: renderedSubject,
      bodyHtml,
      // Fetch address strictly from TemplateDesign
      address: typeof design.address === 'string' ? design.address.replace(/\n/g, '<br/>') : (design.address || undefined),
      policies: typeof variables.policies === 'string' ? variables.policies.replace(/\n/g, '<br/>') : (variables.policies || undefined)
    };

    emailHtml = interpolate(design.html, designVariables);
  }

  const rendered = {
    subject: content.emailSubject ? interpolate(content.emailSubject, variables) : undefined,
    html: emailHtml,
    text: content.emailText ? interpolate(content.emailText, variables) : undefined,
    sms: content.sms ? interpolate(content.sms, variables) : undefined,
  };

  if (!rendered.text && rendered.html) {
    rendered.text = rendered.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (!rendered.sms && rendered.text) {
    rendered.sms = rendered.text;
  }

  return rendered;
}

export async function renderTemplateByKey(key, variables = {}) {
  const tpl = await getTemplateByKey(key);
  if (tpl) {
    return renderDBTemplateContent(tpl, variables);
  }
  // Fallback to in-memory renderer templates
  return renderer.renderTemplate(key, variables);
}

export function renderArbitraryContent(content, variables = {}) {
  return renderer.renderContent(content, variables);
}
