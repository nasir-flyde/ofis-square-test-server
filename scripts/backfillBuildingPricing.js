import mongoose from "mongoose";
import Building from "../models/buildingModel.js";

// Default pricing per seat if not configured
const DEFAULT_PRICING = 5000;

async function backfillBuildingPricing() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/ofis-square");
    console.log("Connected to MongoDB");

    // Find buildings without pricing
    const buildingsWithoutPricing = await Building.find({
      $or: [
        { pricing: null },
        { pricing: { $exists: false } }
      ]
    });

    console.log(`Found ${buildingsWithoutPricing.length} buildings without pricing`);

    if (buildingsWithoutPricing.length === 0) {
      console.log("All buildings already have pricing configured");
      return;
    }

    // Update buildings with default pricing
    const updateResult = await Building.updateMany(
      {
        $or: [
          { pricing: null },
          { pricing: { $exists: false } }
        ]
      },
      {
        $set: { pricing: DEFAULT_PRICING }
      }
    );

    console.log(`Updated ${updateResult.modifiedCount} buildings with default pricing of ₹${DEFAULT_PRICING}/seat`);

    // List updated buildings
    const updatedBuildings = await Building.find({
      _id: { $in: buildingsWithoutPricing.map(b => b._id) }
    }).select('name address pricing');

    console.log("\nUpdated buildings:");
    updatedBuildings.forEach(building => {
      console.log(`- ${building.name} (${building.address}): ₹${building.pricing}/seat`);
    });

    console.log("\n✅ Building pricing backfill completed successfully");
    console.log("⚠️  Please review and update the pricing for each building as needed");

  } catch (error) {
    console.error("Error during building pricing backfill:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillBuildingPricing();
}

export default backfillBuildingPricing;
