import mongoose from 'mongoose';

const uri = "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/ofis-new";

async function checkAllVisitors() {
  try {
    await mongoose.connect(uri);
    const collection = mongoose.connection.collection('visitors');
    
    const allVisitors = await collection.find({}).toArray();
    console.log(`Total visitors in DB: ${allVisitors.length}`);
    
    const deletedCount = allVisitors.filter(v => v.deletedAt != null).length;
    console.log(`Visitors with deletedAt != null: ${deletedCount}`);
    
    const noTokenCount = allVisitors.filter(v => !v.qrToken).length;
    console.log(`Visitors with no qrToken: ${noTokenCount}`);
    
    if (noTokenCount > 0) {
      console.log('Sample visitors with no token:', allVisitors.filter(v => !v.qrToken).slice(0, 5).map(v => v.name));
    }

    const today = new Date().toISOString().split('T')[0];
    const invalidDateCount = allVisitors.filter(v => {
      if (!v.expectedVisitDate) return true;
      const d = new Date(v.expectedVisitDate).toISOString().split('T')[0];
      return d !== today;
    }).length;
    console.log(`Visitors with expectedVisitDate != ${today}: ${invalidDateCount}`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAllVisitors();
