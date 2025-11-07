import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

const csvFilePath = path.resolve(process.cwd(), 'pincode data from gov.in.csv');

export const findLocationByPincode = (pincode) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (data) => {
        if (data.pincode === pincode) {
          results.push({
            PostOfficeName: data.officename,
            Pincode: data.pincode,
            City: data.district,
            District: data.district,
            State: data.statename,
          });
        }
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
};
