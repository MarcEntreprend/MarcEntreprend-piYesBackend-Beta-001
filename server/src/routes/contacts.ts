// server/src/routes/contacts.ts
import express from 'express';
import crypto from 'crypto';
import { authMiddleware, AuthRequest } from '../middleware';
import { supabase } from '../supabase';

const router = express.Router();

// ── Détecte le type de clé et la distribue dans la bonne colonne ──────────────
const detectKeyType = (info: string): { tag?: string; email?: string; phone?: string; randomKey?: string } => {
  if (!info || !info.trim()) return {};
  const trimmed = info.trim();

  // Tag : commence par @ ou ne contient pas de @ ni de chiffres dominants
  if (trimmed.startsWith('@')) return { tag: trimmed };

  // Email : contient @ et un point après
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { email: trimmed };

  // Téléphone : que des chiffres, espaces, tirets, +
  if (/^\+?[\d\s\-]{7,}$/.test(trimmed)) return { phone: trimmed.replace(/[\s\-]/g, '') };

  // Sinon : clé quelconque (randomKey)
  return { randomKey: trimmed };
};

// 1. SYNC CONTACTS (utilisé aussi pour ajout manuel)
router.post('/sync', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { contacts } = req.body;
    if (!Array.isArray(contacts)) return res.status(400).json({ error: 'Contacts array required' });

    const syncedContacts = await Promise.all(contacts.map(async (c) => {
      // Détecter le type si on reçoit un champ générique "info"
      const rawKey = c.info || c.tag || c.email || c.phone || c.randomKey || '';
      const keyFields = rawKey ? detectKeyType(rawKey) : {};

      const resolvedTag       = c.tag       || keyFields.tag       || null;
      const resolvedEmail     = c.email     || keyFields.email     || null;
      const resolvedPhone     = c.phone     || keyFields.phone     || null;
      const resolvedRandomKey = c.randomKey || keyFields.randomKey || null;

      // Chercher si ce contact existe déjà en User (pour le lier)
      // L'ID du user en BDD prévaut toujours — on ne le recrée jamais
      let contactUser: any = null;
      if (resolvedTag) {
        const { data } = await supabase.from('User').select('id, name, tag, phone, email, avatarUrl')
          .ilike('tag', resolvedTag.startsWith('@') ? resolvedTag : `@${resolvedTag}`).maybeSingle();
        contactUser = data;
      }
      if (!contactUser && resolvedPhone) {
        const { data } = await supabase.from('User').select('id, name, tag, phone, email, avatarUrl')
          .eq('phone', resolvedPhone).maybeSingle();
        contactUser = data;
      }
      if (!contactUser && resolvedEmail) {
        const { data } = await supabase.from('User').select('id, name, tag, phone, email, avatarUrl')
          .eq('email', resolvedEmail).maybeSingle();
        contactUser = data;
      }

      // Chercher contact existant pour ce userId (éviter doublon)
      let existing: any = null;

      // Priorité : chercher par contactUserId si on a trouvé le user
      if (contactUser?.id) {
        const { data } = await supabase.from('Contact').select('id')
          .eq('userId', userId).eq('contactUserId', contactUser.id).maybeSingle();
        existing = data;
      }

      // Sinon chercher par les clés
      if (!existing) {
        const orConditions: string[] = [];
        if (resolvedTag)       orConditions.push(`tag.eq.${resolvedTag}`);
        if (resolvedPhone)     orConditions.push(`phone.eq.${resolvedPhone}`);
        if (resolvedEmail)     orConditions.push(`email.eq.${resolvedEmail}`);
        if (resolvedRandomKey) orConditions.push(`randomKey.eq.${resolvedRandomKey}`);

        if (orConditions.length > 0) {
          const { data } = await supabase.from('Contact').select('id')
            .eq('userId', userId).or(orConditions.join(',')).maybeSingle();
          existing = data;
        } else if (c.name) {
          // Fallback sur le nom uniquement si aucune clé
          const { data } = await supabase.from('Contact').select('id')
            .eq('userId', userId).eq('name', c.name).maybeSingle();
          existing = data;
        }
      }

      const now = new Date().toISOString();
      const contactData = {
        userId,
        name:          c.name || contactUser?.name || 'Contact',
        tag:           resolvedTag,
        email:         resolvedEmail,
        phone:         resolvedPhone,
        randomKey:     resolvedRandomKey,
        // Utiliser l'ID BDD du user trouvé — jamais le recréer
        contactUserId: contactUser?.id || c.contactUserId || null,
        isVerified:    !!contactUser,
        avatarUrl:     contactUser?.avatarUrl || c.avatarUrl || null,
        lastTransactionDate: c.lastTransactionDate || null,
        updatedAt:     now,
      };

      let result = null;
      if (existing) {
        const { data: updated, error } = await supabase.from('Contact')
          .update(contactData).eq('id', existing.id).select().single();
        if (error) console.error('Contact update error:', error);
        result = updated;
      } else {
        const { data: created, error } = await supabase.from('Contact')
          .insert({
            ...contactData,
            id: crypto.randomUUID(),
            app: 'piyes',
            isFavorite: false,
            createdAt: now,
          }).select().single();
        if (error) console.error('Contact insert error:', error);
        result = created;
      }

      // Retourner aussi isUserFound pour l'UI
      return result ? { ...result, _isExistingUser: !!contactUser } : null;
    }));

    const filtered = syncedContacts.filter(Boolean);
    res.json(filtered);
  } catch (error) {
    console.error('Contact sync error:', error);
    res.status(500).json({ error: 'Failed to sync contacts' });
  }
});


// 2. GET CONTACTS
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { data: contacts, error } = await supabase
      .from('Contact')
      .select('*')
      .eq('userId', userId)
      .order('name', { ascending: true });

    if (error) throw error;
    res.json(contacts || []);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// 3. UPDATE CONTACT
router.post('/update/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const updates = req.body;

    // Sécurité : s'assurer que le contact appartient au user
    const { data, error } = await supabase
      .from('Contact')
      .update({ ...updates, updatedAt: new Date().toISOString() })
      .eq('id', id)
      .eq('userId', userId)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. DELETE CONTACT
router.delete('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const { error } = await supabase
      .from('Contact')
      .delete()
      .eq('id', id)
      .eq('userId', userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. UPDATE CONTACT (modification d'un contact existant)
router.patch('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { id } = req.params;
    const { name, tag, phone, email, randomKey, isFavorite } = req.body;

    // Vérifier que le contact appartient à ce user
    const { data: existing } = await supabase.from('Contact').select('id, contactUserId')
      .eq('id', id).eq('userId', userId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Contact not found' });

    // Si une nouvelle clé est fournie, vérifier si elle correspond à un user piYès
    let contactUser: any = null;
    const keyToCheck = tag || email || phone || randomKey;
    if (keyToCheck) {
      if (tag) {
        const { data } = await supabase.from('User').select('id, name, avatarUrl')
          .ilike('tag', tag.startsWith('@') ? tag : `@${tag}`).maybeSingle();
        contactUser = data;
      } else if (email) {
        const { data } = await supabase.from('User').select('id, name, avatarUrl')
          .ilike('email', email).maybeSingle();
        contactUser = data;
      } else if (phone) {
        const { data } = await supabase.from('User').select('id, name, avatarUrl')
          .eq('phone', phone).maybeSingle();
        contactUser = data;
      }
    }

    const updateData: any = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (tag !== undefined) updateData.tag = tag;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (randomKey !== undefined) updateData.randomKey = randomKey;
    if (isFavorite !== undefined) updateData.isFavorite = isFavorite;
    // Mettre à jour contactUserId et isVerified si on a trouvé un user correspondant
    if (contactUser) {
      updateData.contactUserId = contactUser.id;
      updateData.isVerified = true;
      updateData.avatarUrl = contactUser.avatarUrl || null;
    }

    const { data, error } = await supabase.from('Contact')
      .update(updateData).eq('id', id).eq('userId', userId).select().single();

    if (error) throw error;
    res.json({ ...data, _isExistingUser: !!contactUser });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;