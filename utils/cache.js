import Building from "../models/buildingModel.js";
import CabinAmenity from "../models/cabinAmenityModel.js";

export let buildingMap = new Map();
export let amenityMap = new Map();

export const initCache = async () => {
    try {
        console.log("⏳ Initializing Building & Amenity Cache...");

        const [buildings, amenities] = await Promise.all([
            Building.find().lean(),
            CabinAmenity.find().lean()
        ]);

        buildingMap = new Map(buildings.map(b => [b._id.toString(), b]));
        amenityMap = new Map(amenities.map(a => [a._id.toString(), a]));

        console.log(`✅ Cache Initialized: ${buildingMap.size} Buildings, ${amenityMap.size} Amenities`);
    } catch (error) {
        console.error("❌ Error initializing cache:", error);
    }
};
