import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import NotificationTemplate from '../models/notificationTemplateModel.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname).substring(1);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-test";

async function syncTemplates() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const jsonPath = path.join(__dirname, '../ofis-test.notificationtemplates.json');
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

        console.log(`Found ${data.length} templates in JSON. Synchronizing...`);

        for (const item of data) {
            const templateData = {
                key: item.key,
                name: item.name,
                description: item.description,
                channels: item.channels,
                content: item.content,
                category: item.category,
                tags: item.tags,
                isActive: item.isActive !== undefined ? item.isActive : true,
                version: item.version ? parseInt(item.version) : 1,
                defaults: item.defaults,
                templateDesignId: item.templateDesignId?.$oid ? item.templateDesignId.$oid : undefined
            };

            await NotificationTemplate.findOneAndUpdate(
                { key: item.key },
                { $set: templateData },
                { upsert: true, new: true, runValidators: true }
            );
            console.log(`  - Synced template: ${item.key}`);
        }

        console.log('✅ Synchronization complete!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during synchronization:', error);
        process.exit(1);
    }
}

syncTemplates();
