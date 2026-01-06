import express from 'express';
import { getCountries, getStates, getCities } from '../controllers/locationsController.js';

const router = express.Router();

// GET /api/locations/countries?search=&limit=
router.get('/countries', getCountries);

// GET /api/locations/states?country=India&search=&limit=
router.get('/states', getStates);

// GET /api/locations/cities?country=India&state=Maharashtra&search=&limit=
router.get('/cities', getCities);

export default router;
