//server/src/routes/friendship.ts

import express from 'express';
import crypto from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware';
import { supabase } from '../supabase';

const router = express.Router();

// 1. REQUEST FRIENDSHIP
router.post('/request', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const requesterId = req.user?.id;
    if (!requesterId) return res.status(401).json({ error: 'Unauthorized' });

    const { contactUserId } = req.body;
    if (!contactUserId) return res.status(400).json({ error: 'contactUserId requis' });

    // Chercher une demande existante dans les deux sens
    const { data: existing } = await supabase
      .from('Friendship')
      .select('*')
      .or(
        `and(requesterId.eq.${requesterId},receiverId.eq.${contactUserId}),and(requesterId.eq.${contactUserId},receiverId.eq.${requesterId})`
      )
      .maybeSingle();

    if (existing) {
      if (existing.status === 'friends') {
        // Déjà amis — renvoyer succès silencieux
        return res.json({ success: true, status: 'already_friends', friendship: existing });
      }
      if (existing.status === 'pending') {
        if (existing.requesterId === requesterId) {
          // Même sens : déjà envoyé — renvoyer la notif sans re-INSERT
          const { data: receiver } = await supabase.from('User').select('name').eq('id', requesterId).single();
          await supabase.from('Notification').insert({
            id: crypto.randomUUID(),
            userId: contactUserId,
            type: 'FRIEND_REQUEST',
            title: 'Demande d\'ami',
            body: `${receiver?.name} vous a envoyé une demande d\'ami.`,
            isRead: false,
            route: '/contacts',
            targetId: requesterId,
            timestamp: new Date().toISOString(),
          });
          return res.json({ success: true, status: 'resent', friendship: existing });
        }
        // Sens inverse : l'autre a déjà demandé → accepter automatiquement
        const now = new Date().toISOString();
        await supabase.from('Friendship')
          .update({ status: 'friends', updatedAt: now })
          .eq('id', existing.id);

        const { data: requester } = await supabase.from('User').select('name').eq('id', requesterId).single();
        const { data: receiver } = await supabase.from('User').select('name').eq('id', contactUserId).single();

        // Notif aux deux
        await supabase.from('Notification').insert([
          {
            id: crypto.randomUUID(), userId: contactUserId, type: 'FRIEND_ACCEPTED',
            title: 'Demande acceptée', body: `${requester?.name} a accepté votre demande d\'ami.`,
            isRead: false, route: '/contacts', targetId: requesterId, timestamp: now,
          },
          {
            id: crypto.randomUUID(), userId: requesterId, type: 'FRIEND_ACCEPTED',
            title: 'Vous êtes maintenant amis', body: `Vous êtes maintenant amis avec ${receiver?.name}.`,
            isRead: false, route: '/contacts', targetId: contactUserId, timestamp: now,
          }
        ]);

        return res.json({ success: true, status: 'auto_accepted' });
      }
      if (existing.status === 'blocked') {
        return res.status(403).json({ error: 'Impossible d\'envoyer une demande à cet utilisateur' });
      }
    }

    // Aucune relation existante → créer
    const now = new Date().toISOString();
    const { data: friendship, error } = await supabase.from('Friendship').insert({
      id: crypto.randomUUID(),
      requesterId,
      receiverId: contactUserId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }).select().single();

    if (error) throw error;

    const { data: requester } = await supabase.from('User').select('name, tag, phone, email, avatarUrl').eq('id', requesterId).single();

    await supabase.from('Notification').insert({
      id: crypto.randomUUID(),
      userId: contactUserId,
      type: 'FRIEND_REQUEST',
      title: 'Demande d\'ami',
      body: `${requester?.name} vous a envoyé une demande d\'ami.`,
      isRead: false,
      route: '/contacts',
      targetId: requesterId,
      timestamp: now,
    });

    res.json({ success: true, status: 'sent', friendship });
  } catch (e: any) {
    console.error('Friendship request error:', e);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// 2. ACCEPT FRIENDSHIP
router.post('/accept', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { requesterId } = req.body;
    if (!userId || !requesterId) return res.status(400).json({ error: 'Missing IDs' });

    const { data: friendship, error } = await supabase
      .from('Friendship')
      .update({ status: 'friends', updatedAt: new Date().toISOString() })
      .eq('requesterId', requesterId)
      .eq('receiverId', userId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !friendship) return res.status(400).json({ error: 'Request not found' });

    // Create notification for requester
    await supabase.from('Notification').insert({
      id: crypto.randomUUID(),
      userId: requesterId,
      type: 'FRIEND_ACCEPTED',
      title: 'Demande acceptée',
      body: 'Votre demande d\'ami a été acceptée.',
      route: `/contact/${userId}`,
      targetId: userId,
      timestamp: new Date().toISOString(),
      isRead: false
    });

    res.json(friendship);
  } catch (error) {
    console.error('Friendship accept error:', error);
    res.status(500).json({ error: 'Failed to accept request' });
  }
});

// 3. CANCEL/REFUSE FRIENDSHIP
router.delete('/cancel', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { contactUserId } = req.query;
    if (!userId || !contactUserId) return res.status(400).json({ error: 'Missing IDs' });

    const { error } = await supabase
      .from('Friendship')
      .delete()
      .or(`and(requesterId.eq.${userId},receiverId.eq.${contactUserId}),and(requesterId.eq.${contactUserId},receiverId.eq.${userId})`);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Friendship cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel relationship' });
  }
});

// 4. GET STATUS
router.get('/status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { with: contactUserId } = req.query;
    if (!userId || !contactUserId) return res.status(400).json({ error: 'Missing IDs' });

    const { data: friendship } = await supabase
      .from('Friendship')
      .select('*')
      .or(`and(requesterId.eq.${userId},receiverId.eq.${contactUserId}),and(requesterId.eq.${contactUserId},receiverId.eq.${userId})`)
      .maybeSingle();

    res.json(friendship || null);
  } catch (error) {
    console.error('Friendship status error:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

export default router;
