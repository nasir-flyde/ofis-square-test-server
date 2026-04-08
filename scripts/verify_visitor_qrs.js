import mongoose from 'mongoose';

const uri = "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-new";

async function verifyUpdates() {
  try {
    await mongoose.connect(uri);
    const collection = mongoose.connection.collection('visitors');
    const visitors = await collection.find({}).toArray();

    console.log(`Total visitors: ${visitors.length}`);
    visitors.forEach(v => {
      console.log(`Visitor: ${v.name}, Status: ${v.status}, Expires: ${v.qrExpiresAt}, Deleted: ${v.deletedAt}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error verifying updates:', error);
    process.exit(1);
  }
}

verifyUpdates();
