import mongoose from 'mongoose';
import DocSupportCategory from './models/docSupportCategoryModel.js';
import dotenv from 'dotenv';

dotenv.config();

const fixCategories = async () => {
    try {
        await mongoose.connect('mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net//ofis-prod');
        console.log('Connected to MongoDB');

        const categories = await DocSupportCategory.find();
        console.log(`Found ${categories.length} categories`);

        for (const cat of categories) {
            if (typeof cat.name === 'object' && cat.name.type) {
                const newName = cat.name.type;
                console.log(`Fixing category ${cat._id}: ${JSON.stringify(cat.name)} -> ${newName}`);
                cat.name = newName;
                await cat.save();
            }
        }

        console.log('Done fixing categories');
        process.exit(0);
    } catch (err) {
        console.error('Error fixing categories:', err);
        process.exit(1);
    }
};

fixCategories();
