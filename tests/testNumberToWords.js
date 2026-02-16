import { numberToWords } from '../utils/numberToWords.js';

const testCases = [
  100, 1500, 50000, 100000, 150000, 1000000, 10500000, 560000, 1234.56
];

testCases.forEach(num => {
  console.log(`${num} => ${numberToWords(num)}`);
});
