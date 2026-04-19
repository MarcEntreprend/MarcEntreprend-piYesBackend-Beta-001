// server/src/routes/scheduler.ts
import express from 'express';
import crypto from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware';
import { supabase } from '../supabase';
import { ReminderSlot } from '../../../shared/types';

const router = express.Router();

const generateId = () => crypto.randomUUID();

// ── Helper : générer les slots de rappel entre aujourd'hui et dueDate ──────────
function buildReminderSlots(dueDateStr: string): ReminderSlot[] {
  const slots: ReminderSlot[] = [];
  const now = new Date();
  const due = new Date(dueDateStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  for (let d = new Date(today); d <= dueDay; d.setDate(d.getDate() + 1)) {
    const isToday = d.toDateString() === now.toDateString();
    const currentHour = now.getHours() * 60 + now.getMinutes();
    // 08h30 = 510 min, 12h30 = 750 min
    const time1Active = isToday ? currentHour < 510 : true;
    const time2Active = isToday ? currentHour < 750 : true;
    slots.push({
      date: d.toISOString().split('T')[0],
      time1Active,
      time2Active,
    });
  }
  return slots;
}

// ── Helper : vérifier amitié mutuelle ─────────────────────────────────────────
async function areFriends(userAId: string, userBId: string): Promise<boolean> {
  const { data } = await supabase
    .from('Friendship')
    .select('id')
    .or(
      `and(requesterId.eq.${userAId},receiverId.eq.${userBId}),and(requesterId.eq.${userBId},receiverId.eq.${userAId})`
    )
    .eq('status', 'friends')
    .maybeSingle();
  return !!data;
}

// ── Helper : créer une notification ───────────────────────────────────────────
async function createNotif(
  userId: string, type: string, title: string, body: string,
  targetId?: string, route?: string, amount?: string, extraData?: string
) {
  await supabase.from('Notification').insert({
    id: generateId(),
    userId,
    type,
    title,
    body,
    amount: amount || null,
    isRead: false,
    route: route || '/scheduler',
    targetId: targetId || null,
    // Stocker les données extra dans le champ 'amount' si pas d'amount, sinon dans body
    // Note: on utilise un préfixe JSON pour distinguer
    ...(extraData ? { amount: extraData } : {}),
    timestamp: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CRÉER un rappel (receiver seulement)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/create', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const receiverUserId = req.user?.id;
    if (!receiverUserId) return res.status(401).json({ error: 'Unauthorized' });

    const { title, payerUserId, payerName, amount, dueDate, reminders } = req.body;

    if (!amount || !dueDate || !payerName) {
      return res.status(400).json({ error: { message: 'amount, dueDate et payerName sont requis' } });
    }

    const amountCents = Math.round(parseFloat(amount) * 100);

    // Vérifier amitié si payerUserId fourni
    if (payerUserId) {
      const friends = await areFriends(receiverUserId, payerUserId);
      if (!friends) {
        return res.status(403).json({ error: { message: 'NOT_FRIENDS', code: 'NOT_FRIENDS' } });
      }
    }

    // Récupérer infos receiver
    const { data: receiver } = await supabase.from('User').select('name').eq('id', receiverUserId).single();

    // Générer les slots de rappel
    const slots: ReminderSlot[] = reminders || buildReminderSlots(dueDate);

    // Générer token QR (valide 2 min)
    const qrToken = crypto.randomBytes(24).toString('hex');
    const qrExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const id = generateId();
    const { data: sched, error } = await supabase
      .from('ScheduledPayment')
      .insert({
        id,
        userId: receiverUserId,      // userId = receiver (convention actuelle)
        receiverUserId,
        payerUserId: payerUserId || null,
        title: title || `Demande de ${receiver?.name || 'piYès'}`,
        counterparty: payerName,
        amount: amountCents,
        dueDate: new Date(dueDate).toISOString(),
        status: 'pending',
        type: 'incoming',
        frequency: 'once',
        reminders: slots,
        confirmedAt: null,
        qrToken,
        qrExpiresAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    // Notif au receiver
    await createNotif(
      receiverUserId,
      'scheduled_created',
      'Rappel créé',
      `Un rappel de ${amount} G. a été créé pour ${payerName}. En attente de confirmation.`,
      id,
      '/scheduler'
    );

      // Si payerUserId connu → notif au payeur avec infos du receiver pour contact
      if (payerUserId) {
      // Récupérer infos complètes du receiver pour les inclure dans la notif
      const { data: receiverFull } = await supabase
        .from('User').select('id, name, tag, phone, email, avatarUrl').eq('id', receiverUserId).single();

      await createNotif(
        payerUserId,
        'scheduled_request',
        'Demande de paiement',
        `${receiver?.name} vous demande ${amount} G. avant le ${new Date(dueDate).toLocaleDateString('fr-HT')}. Confirmez via le QR/lien reçu.`,
        id,       // targetId = scheduleId pour ouvrir le modal de confirmation
        '/scheduler',
        undefined,
        // Stocker les infos du receiver dans un champ supplémentaire
        receiverFull ? JSON.stringify({
          receiverUserId,
          receiverName: receiverFull.name,
          receiverTag: receiverFull.tag,
          receiverPhone: receiverFull.phone,
          receiverEmail: receiverFull.email,
          receiverAvatarUrl: receiverFull.avatarUrl,
        }) : undefined
      );
    }

    res.json({
      ...sched,
      amount: sched.amount / 100,
      qrToken,
      qrExpiresAt,
    });
  } catch (e: any) {
    console.error('Scheduler create error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. REGÉNÉRER le QR token (receiver → relancer confirmation)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/regenerate-qr', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const { data: sched } = await supabase
      .from('ScheduledPayment').select('*').eq('id', id).single();

    if (!sched || sched.receiverUserId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (sched.status === 'cancelled' || sched.status === 'paid') {
      return res.status(400).json({ error: 'Cannot regenerate QR for this status' });
    }

    const qrToken = crypto.randomBytes(24).toString('hex');
    const qrExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    await supabase.from('ScheduledPayment')
      .update({ qrToken, qrExpiresAt, updatedAt: new Date().toISOString() })
      .eq('id', id);

    res.json({ qrToken, qrExpiresAt });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CONFIRMER un rappel (payeur via QR/lien)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/confirm', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const payerUserId = req.user?.id;
    if (!payerUserId) return res.status(401).json({ error: 'Unauthorized' });

    const { qrToken, scheduleId } = req.body;
    if (!qrToken && !scheduleId) return res.status(400).json({ error: 'qrToken ou scheduleId requis' });

    // Trouver le rappel par token ou par ID
    let sched;
    if (qrToken) {
      const { data } = await supabase
        .from('ScheduledPayment').select('*').eq('qrToken', qrToken).maybeSingle();
      sched = data;
    } else {
      const { data } = await supabase
        .from('ScheduledPayment').select('*').eq('id', scheduleId).maybeSingle();
      sched = data;
    }

    if (!sched) return res.status(404).json({ error: 'Rappel introuvable ou token invalide' });
    if (sched.status !== 'pending') return res.status(400).json({ error: 'Ce rappel est déjà confirmé ou annulé' });
    
    // Si un payeur spécifique est désigné, seul lui peut confirmer
    if (sched.payerUserId && sched.payerUserId !== payerUserId) {
      return res.status(403).json({ error: 'Ce rappel est destiné à un autre utilisateur' });
    }

    // Vérifier expiry seulement si lookup par token
    const isTokenLookup = sched.qrToken === qrToken;
    if (isTokenLookup && sched.qrExpiresAt && new Date() > new Date(sched.qrExpiresAt)) {
      return res.status(410).json({ error: { message: 'QR_EXPIRED', code: 'QR_EXPIRED' } });
    }

    const { data: receiver } = await supabase.from('User').select('name').eq('id', sched.receiverUserId).single();
    const { data: payer } = await supabase.from('User').select('name').eq('id', payerUserId).single();

    // Confirmer
    await supabase.from('ScheduledPayment').update({
      status: 'confirmed',
      payerUserId,
      counterparty: payer?.name || sched.counterparty,
      confirmedAt: new Date().toISOString(),
      qrToken: null,  // invalider le token
      qrExpiresAt: null,
      updatedAt: new Date().toISOString(),
    }).eq('id', sched.id);

    // Créer version "outgoing" pour le payeur
    await supabase.from('ScheduledPayment').insert({
      id: generateId(),
      userId: payerUserId,
      receiverUserId: sched.receiverUserId,
      payerUserId,
      title: sched.title,
      counterparty: receiver?.name || 'piYès',
      amount: sched.amount,
      dueDate: sched.dueDate,
      status: 'confirmed',
      type: 'outgoing',
      frequency: sched.frequency,
      reminders: sched.reminders,
      confirmedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Sauvegarder les contacts des deux côtés
    const now = new Date().toISOString();
    // Receiver sauvegarde payeur dans ses contacts
    const { data: existingContactR } = await supabase.from('Contact').select('id')
      .eq('userId', sched.receiverUserId).eq('contactUserId', payerUserId).maybeSingle();
    if (!existingContactR) {
      await supabase.from('Contact').insert({
        id: generateId(), userId: sched.receiverUserId, contactUserId: payerUserId,
        name: payer?.name || sched.counterparty, app: 'piyes', isVerified: true,
        isFavorite: false, createdAt: now, updatedAt: now,
      });
    }
    // Payeur sauvegarde receiver dans ses contacts
    const { data: existingContactP } = await supabase.from('Contact').select('id')
      .eq('userId', payerUserId).eq('contactUserId', sched.receiverUserId).maybeSingle();
    if (!existingContactP) {
      await supabase.from('Contact').insert({
        id: generateId(), userId: payerUserId, contactUserId: sched.receiverUserId,
        name: receiver?.name || 'Receiver', app: 'piyes', isVerified: true,
        isFavorite: false, createdAt: now, updatedAt: now,
      });
    }

    const remindersCount = (sched.reminders as ReminderSlot[] || [])
      .reduce((acc: number, r: ReminderSlot) => acc + (r.time1Active ? 1 : 0) + (r.time2Active ? 1 : 0), 0);

    // Notif receiver
    await createNotif(
      sched.receiverUserId,
      'scheduled_confirmed',
      'Rappel confirmé !',
      `${payer?.name} a confirmé votre demande de ${sched.amount / 100} G. ${remindersCount} rappels programmés.`,
      sched.id, '/scheduler',
      String(sched.amount / 100)
    );

    // Notif payeur
    await createNotif(
      payerUserId,
      'scheduled_confirmed',
      'Rappel enregistré',
      `Vous avez confirmé un paiement de ${sched.amount / 100} G. pour ${receiver?.name}. Échéance : ${new Date(sched.dueDate).toLocaleDateString('fr-HT')}.`,
      sched.id, '/scheduler',
      String(sched.amount / 100)
    );

    res.json({ success: true, scheduleId: sched.id });
  } catch (e: any) {
    console.error('Scheduler confirm error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ANNULER / MASQUER un rappel
//    - Receiver : hard delete des deux côtés (comportement existant)
//    - Payeur   : soft hide de son propre item outgoing payé uniquement
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const { data: sched } = await supabase
      .from('ScheduledPayment').select('*').eq('id', id).single();

    if (!sched) return res.status(404).json({ error: 'Not found' });

    // ── CAS 1 : Receiver → hard delete des deux côtés ────────────────────
    if (sched.receiverUserId === userId) {
      await supabase.from('ScheduledPayment').delete().eq('id', id);

      if (sched.payerUserId) {
        // Hard delete de l'item outgoing du payeur aussi
        await supabase.from('ScheduledPayment').delete()
          .eq('receiverUserId', sched.receiverUserId)
          .eq('payerUserId', sched.payerUserId)
          .eq('type', 'outgoing');

        const { data: receiver } = await supabase.from('User').select('name').eq('id', userId).single();
        await createNotif(
          sched.payerUserId,
          'scheduled_cancelled',
          'Rappel supprimé',
          `${receiver?.name} a supprimé la demande de paiement de ${sched.amount / 100} G.`,
          String(id), '/scheduler'
        );
        // Notif au receiver lui-même
        await createNotif(
          userId,
          'scheduled_cancelled',
          'Rappel supprimé',
          `Vous avez supprimé le rappel de ${sched.amount / 100} G. pour ${sched.counterparty}.`,
          String(id), '/scheduler'
        );
      }

      return res.json({ success: true, action: 'deleted' });
    }

    // ── CAS 2 : Payeur → soft hide de son propre item outgoing payé ──────
    if (sched.payerUserId === userId && sched.type === 'outgoing' && sched.status === 'paid') {
      await supabase.from('ScheduledPayment')
        .update({ hiddenByUserId: userId, updatedAt: new Date().toISOString() })
        .eq('id', id);

      return res.json({ success: true, action: 'hidden' });
    }

    // ── CAS 3 : Ni receiver ni payeur autorisé ───────────────────────────
    return res.status(403).json({ error: 'Action non autorisée sur ce rappel' });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. METTRE À JOUR les reminders (receiver seulement)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:id/reminders', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { reminders } = req.body as { reminders: ReminderSlot[] };

    if (!Array.isArray(reminders)) return res.status(400).json({ error: 'reminders array requis' });

    // Au moins un rappel actif
    const hasActive = reminders.some(r => r.time1Active || r.time2Active);
    if (!hasActive) {
      return res.status(400).json({ error: { message: 'Au moins un rappel doit rester actif', code: 'NO_ACTIVE_REMINDER' } });
    }

    const { data: sched } = await supabase
      .from('ScheduledPayment').select('receiverUserId').eq('id', id).single();
    if (!sched || sched.receiverUserId !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await supabase.from('ScheduledPayment').update({
      reminders, updatedAt: new Date().toISOString()
    }).eq('id', id);

    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. GET rappels du user (incoming + outgoing), excluant les masqués
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('ScheduledPayment')
      .select('*')
      .eq('userId', userId)
      .not('status', 'eq', 'cancelled')
      // Exclure les items que cet utilisateur a masqués de son côté
      .or(`hiddenByUserId.is.null,hiddenByUserId.neq.${userId}`)
      .order('dueDate', { ascending: true });

    if (error) throw error;

    const mapped = (data || []).map((s: any) => ({
      ...s,
      amount: s.amount / 100,
    }));

    res.json(mapped);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. GET info d'un rappel par QR token (pour le payeur qui scanne)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/by-token/:token', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { token } = req.params;
    let { data: sched } = await supabase
      .from('ScheduledPayment').select('*').eq('qrToken', token).maybeSingle();

    if (!sched) {
      // Fallback to ID if not found by token
      const { data } = await supabase.from('ScheduledPayment').select('*').eq('id', token).maybeSingle();
      sched = data;
    }

    if (!sched) return res.status(404).json({ error: 'Token ou ID invalide' });
    if (sched.status !== 'pending') return res.status(400).json({ error: 'Ce rappel est déjà confirmé ou annulé' });

    // Si un payeur spécifique est désigné, seul lui peut voir les détails
    if (sched.payerUserId && sched.payerUserId !== req.user?.id) {
      return res.status(403).json({ error: 'Ce rappel est destiné à un autre utilisateur' });
    }

    // Check expiry ONLY if lookup was by token
    const isTokenLookup = sched.qrToken === token;
    if (isTokenLookup && sched.qrExpiresAt && new Date() > new Date(sched.qrExpiresAt)) {
      return res.status(410).json({ error: { message: 'QR_EXPIRED', code: 'QR_EXPIRED' } });
    }

    const { data: receiver } = await supabase.from('User').select('id, name, tag, avatarUrl').eq('id', sched.receiverUserId).single();

    res.json({
      id: sched.id,
      title: sched.title,
      amount: sched.amount / 100,
      dueDate: sched.dueDate,
      reminders: sched.reminders,
      receiver: {
        id: sched.receiverUserId,   // ← ajouté pour permettre le lookup côté frontend
        name: receiver?.name,
        tag: receiver?.tag,
        avatarUrl: receiver?.avatarUrl,
      },
      qrExpiresAt: sched.qrExpiresAt,
      qrToken: sched.qrToken,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. VÉRIFIER si un rappel actif existe entre deux users (pour bloquer suppression contact/amitié)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/active-between', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    const { otherUserId } = req.query as { otherUserId: string };
    if (!otherUserId) return res.status(400).json({ error: 'otherUserId requis' });

    const { data } = await supabase
      .from('ScheduledPayment')
      .select('id')
      .in('status', ['pending', 'confirmed'])
      .or(
        `and(receiverUserId.eq.${userId},payerUserId.eq.${otherUserId}),and(receiverUserId.eq.${otherUserId},payerUserId.eq.${userId})`
      )
      .limit(1);

    res.json({ hasActiveSchedule: !!(data && data.length > 0) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. TRIGGER des notifications de rappel (à appeler par un cron ou manuellement)
//    En prod : brancher un cron job qui appelle POST /scheduler/trigger-reminders
// ─────────────────────────────────────────────────────────────────────────────
router.post('/trigger-reminders', async (req, res) => {
  try {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const todayStr = now.toISOString().split('T')[0];

    // On ne déclenche qu'à 08h30 ou 12h30 (±5 min de tolérance)
    const isTime1 = currentHour === 8 && currentMin >= 25 && currentMin <= 35;
    const isTime2 = currentHour === 12 && currentMin >= 25 && currentMin <= 35;
    if (!isTime1 && !isTime2) {
      return res.json({ skipped: true, reason: 'Not a reminder time' });
    }

    const slotKey = isTime1 ? 'time1Active' : 'time2Active';
    const slotLabel = isTime1 ? '08h30' : '12h30';

    // Chercher tous les rappels confirmés ou pending non expirés
    const { data: schedules } = await supabase
      .from('ScheduledPayment')
      .select('*')
      .in('status', ['pending', 'confirmed'])
      .lte('dueDate', new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString());

    let triggered = 0;
    for (const sched of schedules || []) {
      const reminders = sched.reminders as any[] || [];
      const todaySlot = reminders.find((r: any) => r.date === todayStr);
      if (!todaySlot || !todaySlot[slotKey]) continue;

      const { data: receiver } = await supabase.from('User').select('name').eq('id', sched.receiverUserId).single();
      const amountHTG = sched.amount / 100;

      // Notif au payeur
      if (sched.payerUserId) {
        const remindersLeft = reminders
          .filter((r: any) => r.date >= todayStr)
          .reduce((a: number, r: any) => a + (r.time1Active ? 1 : 0) + (r.time2Active ? 1 : 0), 0);

        await createNotif(
          sched.payerUserId,
          'scheduled_request',
          `Rappel de paiement — ${slotLabel}`,
          `N'oubliez pas : ${amountHTG} G. à payer à ${receiver?.name}. Échéance : ${new Date(sched.dueDate).toLocaleDateString('fr-HT')}. ${remindersLeft} rappels restants.`,
          sched.id, '/scheduler', String(amountHTG)
        );
      }

      // Notif au receiver
      if (sched.receiverUserId) {
        const { data: payer } = await supabase.from('User').select('name').eq('id', sched.payerUserId).maybeSingle();
        const payerName = payer?.name || sched.counterparty;
        await createNotif(
          sched.receiverUserId,
          'scheduled_created',
          `Rappel envoyé — ${slotLabel}`,
          `Un rappel de ${amountHTG} G. a été envoyé à ${payerName}. Échéance : ${new Date(sched.dueDate).toLocaleDateString('fr-HT')}.`,
          sched.id, '/scheduler'
        );
      }
      triggered++;
    }

    res.json({ triggered });
  } catch (e: any) {
    console.error('Trigger reminders error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;