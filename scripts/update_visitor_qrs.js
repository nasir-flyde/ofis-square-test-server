import mongoose from 'mongoose';

const uri = "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-new";

async function updateQRs() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('Connected to database: ofis-new');

    const collection = mongoose.connection.collection('visitors');

    // Future date for expiry
    const futureDate = new Date('2027-01-01T23:59:59.999Z');

    console.log('Updating all visitors...');
    const result = await collection.updateMany(
      {}, // Update all documents
      {
        $set: {
          status: 'invited',
          qrExpiresAt: futureDate,
          deletedAt: null
        }
      }
    );

    console.log(`Update complete!`);
    console.log(`Matched: ${result.matchedCount}`);
    console.log(`Modified: ${result.modifiedCount}`);

    process.exit(0);
  } catch (error) {
    console.error('Error updating QR codes:', error);
    process.exit(1);
  }
}

updateQRs();
