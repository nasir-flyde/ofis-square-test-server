import fs from 'fs';
import path from 'path';

const jsonPath = path.resolve('ofis-test.notificationtemplates.json');

try {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`Processing ${data.length} templates...`);

    const updatedData = data.map(t => {
        // 1. Ensure channels for App/Push are enabled for all
        t.channels = t.channels || {};
        t.channels.inApp = true;
        t.channels.push = true;

        // 2. Handle Visitor templates specifically (must have email)
        if (t.category === 'visitors' || t.key.includes('visitor')) {
            t.channels.email = true;
        }

        // 3. Ensure In-App content exists
        t.content = t.content || {};
        if (!t.content.inAppTitle) {
            t.content.inAppTitle = t.content.emailSubject || t.name;
        }
        if (!t.content.inAppBody) {
            t.content.inAppBody = t.content.sms || (t.content.emailText ? t.content.emailText.substring(0, 150) + '...' : t.description);
        }

        // 4. Ensure Email content exists for Visitor templates
        if (t.category === 'visitors' || t.key.includes('visitor')) {
            if (!t.content.emailSubject) {
                t.content.emailSubject = t.content.inAppTitle || t.name;
            }
            if (!t.content.emailText) {
                t.content.emailText = t.content.inAppBody || t.description;
            }
        }

        return t;
    });

    fs.writeFileSync(jsonPath, JSON.stringify(updatedData, null, 2));
    console.log('✅ Updated ofis-test.notificationtemplates.json with global In-App and Email support.');

} catch (e) {
    console.error('❌ Error updating templates:', e);
    process.exit(1);
}
