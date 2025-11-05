import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function fixInvoiceIndexes() {
  try {
    console.log("🔧 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI || "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/test");
    
    const db = mongoose.connection.db;
    const collection = db.collection('invoices');
    
    console.log("📋 Current indexes:");
    const indexes = await collection.indexes();
    indexes.forEach(index => {
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    try {
      console.log("\n🗑️  Dropping old unique constraint...");
      await collection.dropIndex("unique_credit_monthly_invoice");
      console.log("✅ Successfully dropped old constraint");
    } catch (error) {
      if (error.code === 27) {
        console.log("ℹ️  Old constraint doesn't exist (already dropped)");
      } else {
        console.log("⚠️  Error dropping old constraint:", error.message);
      }
    }
    
    try {
      console.log("\n🔨 Creating new category-based constraint...");
      await collection.createIndex(
        { 
          client: 1, 
          "billing_period.start": 1, 
          "billing_period.end": 1, 
          type: 1, 
          category: 1 
        },
        { 
          unique: true, 
          partialFilterExpression: { type: "credit_monthly" },
          name: "unique_credit_monthly_invoice_by_category"
        }
      );
      console.log("✅ Successfully created new category-based constraint");
    } catch (error) {
      if (error.code === 85) {
        console.log("ℹ️  New constraint already exists");
      } else {
        console.log("❌ Error creating new constraint:", error.message);
      }
    }
    
    console.log("\n📋 Updated indexes:");
    const updatedIndexes = await collection.indexes();
    updatedIndexes.forEach(index => {
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}`);
    });
    
    console.log("\n✅ Index fix completed successfully!");
    
  } catch (error) {
    console.error("❌ Error fixing indexes:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

// Run the fix
fixInvoiceIndexes();
