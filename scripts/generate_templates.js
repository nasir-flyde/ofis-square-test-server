import fs from 'fs';
import path from 'path';

const jsonPath = path.resolve('ofis-test.notificationtemplates.json');

try {
    const content = fs.readFileSync(jsonPath, 'utf8');
    const templates = JSON.parse(content);

    const rendererTemplates = {};

    templates.forEach(t => {
        rendererTemplates[t.key] = {
            subject: t.content.emailSubject,
            text: t.content.emailText,
            html: t.content.emailText ? t.content.emailText.replace(/\\n/g, '<br/>').replace(/\n/g, '<br/>') : '',
            sms: t.content.sms || (t.content.smsText)
        };

        // If explicit html content exists in JSON (unlikely based on view, usually simple text), use it.
        // The JSON viewed had emailText with \n. I will convert \n to <br/> for HTML.
        if (t.content.emailHtml) {
            rendererTemplates[t.key].html = t.content.emailHtml;
        }
    });

    console.log(JSON.stringify(rendererTemplates, null, 2));

} catch (e) {
    console.error(e);
}
