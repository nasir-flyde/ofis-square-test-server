import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';

// Simple in-memory cache for location data loaded from CSV
let __locationsLoaded = false;
let __rows = [];
let __states = new Set();
let __citiesByState = new Map();
let __allCities = new Set();

const csvFilePath = path.resolve(process.cwd(), 'pincode data from gov.in.csv');

function normalize(str) {
  return (str || '').toString().trim();
}

async function loadLocations() {
  if (__locationsLoaded) return;
  await new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (data) => {
        // CSV columns observed in existing utils: officename, pincode, district, statename
        const state = normalize(data.statename);
        const city = normalize(data.district);
        if (!state || !city) return;
        rows.push({ state, city, country: 'India' });
      })
      .on('end', () => {
        __rows = rows;
        __states = new Set();
        __citiesByState = new Map();
        __allCities = new Set();

        for (const r of rows) {
          __states.add(r.state);
          __allCities.add(r.city);
          if (!__citiesByState.has(r.state)) __citiesByState.set(r.state, new Set());
          __citiesByState.get(r.state).add(r.city);
        }
        __locationsLoaded = true;
        resolve();
      })
      .on('error', (err) => reject(err));
  });
}

function applySearchFilter(items, search) {
  if (!search) return items;
  const s = search.toLowerCase();
  return items.filter((it) => it.toLowerCase().includes(s));
}

export const getCountries = async (req, res) => {
  try {
    // Current dataset is India-only; still support search and future extension
    const { search = '', limit } = req.query || {};
    let countries = ['India'];
    countries = applySearchFilter(countries, search);
    if (limit) countries = countries.slice(0, Number(limit) || 50);
    res.json({ success: true, data: countries });
  } catch (err) {
    console.error('getCountries error', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getStates = async (req, res) => {
  try {
    await loadLocations();
    const { country = 'India', search = '', limit } = req.query || {};
    // Only India is supported by dataset; ignore other countries for now
    let states = Array.from(__states);
    states = applySearchFilter(states, search);
    if (limit) states = states.slice(0, Number(limit) || 50);
    res.json({ success: true, data: states });
  } catch (err) {
    console.error('getStates error', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCities = async (req, res) => {
  try {
    await loadLocations();
    const { state = '', country = 'India', search = '', limit } = req.query || {};

    let cities;
    if (state) {
      const set = __citiesByState.get(state) || new Set();
      cities = Array.from(set);
    } else {
      cities = Array.from(__allCities);
    }

    cities = applySearchFilter(cities, search);
    if (limit) cities = cities.slice(0, Number(limit) || 50);
    res.json({ success: true, data: cities });
  } catch (err) {
    console.error('getCities error', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
