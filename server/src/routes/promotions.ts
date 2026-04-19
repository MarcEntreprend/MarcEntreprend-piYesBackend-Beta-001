
import express from 'express';
import { supabase } from '../supabase';

const router = express.Router();

// 1. GET PROMOTIONS
router.get('/', async (req, res) => {
  try {
    const { data: promotions } = await supabase
      .from('Promotion')
      .select('*')
      .eq('isActive', true)
      .order('createdAt', { ascending: false })
      .limit(10);
    
    res.json(promotions || []);
  } catch (error) {
    console.error('Promotion list error:', error);
    res.status(500).json({ error: 'Failed to fetch promotions' });
  }
});

export default router;
