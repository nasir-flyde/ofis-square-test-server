import express from 'express';
import { getCountries, getStates, getCities } from '../controllers/locationsController.js';

const router = express.Router();
router.get('/countries', getCountries);
router.get('/states', getStates);
router.get('/cities', getCities);

export default router;
//ok