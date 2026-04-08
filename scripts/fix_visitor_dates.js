import mongoose from 'mongoose';

const uris = [
  "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-new",
  "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-test"
];

async function fixDates() {
  for (const uri of uris) {
    try {
      console.log(`Connecting to ${uri}...`);
      const conn = await mongoose.createConnection(uri).asPromise();
      console.log(`Connected to ${conn.name}`);

      const collection = conn.collection('visitors');
      // Set to 2026-04-08T12:00:00.000Z to ensure .toISOString().split('T')[0] provides 2026-04-08
      const todayDate = new Date('2026-04-08T12:00:00.000Z');

      const result = await collection.updateMany(
        {},
        {
          $set: {
            expectedVisitDate: todayDate
          }
        }
      );

      console.log(`Updated ${conn.name}: Matched ${result.matchedCount}, Modified ${result.modifiedCount}`);
      await conn.close();
    } catch (error) {
      console.error(`Error updating ${uri}:`, error);
    }
  }
  process.exit(0);
}

fixDates();
