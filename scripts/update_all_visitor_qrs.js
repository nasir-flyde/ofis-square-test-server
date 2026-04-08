import mongoose from 'mongoose';

const uris = [
  "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-new",
  "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-test"
];

async function updateAllDbs() {
  for (const uri of uris) {
    try {
      console.log(`Connecting to ${uri}...`);
      const conn = await mongoose.createConnection(uri).asPromise();
      console.log(`Connected to ${conn.name}`);

      const collection = conn.collection('visitors');
      const futureDate = new Date('2027-01-01T23:59:59.999Z');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await collection.updateMany(
        {},
        {
          $set: {
            status: 'invited',
            qrExpiresAt: futureDate,
            expectedVisitDate: today,
            deletedAt: null
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

updateAllDbs();
