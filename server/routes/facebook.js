const express = require('express');
const axios = require('axios');
const { supabase } = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get Facebook login URL
router.get('/login-url', authenticateToken, (req, res) => {
  const fbAppId = process.env.FACEBOOK_APP_ID;
  const redirectUri = `${process.env.CLIENT_URL}/dashboard.html`;
  const scope = 'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_read_user_content,pages_messaging';
  
  const loginUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code`;
  
  res.json({ loginUrl });
});

// Handle Facebook OAuth callback and get pages
router.post('/connect', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    const userId = req.user.id;

    // Exchange code for access token
    const tokenResponse = await axios.get(
      `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(process.env.CLIENT_URL + '/dashboard.html')}&client_secret=${process.env.FACEBOOK_APP_SECRET}&code=${code}`
    );

    const accessToken = tokenResponse.data.access_token;

    // Get user's pages
    const pagesResponse = await axios.get(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`
    );

    const pages = pagesResponse.data.data;

    // Store pages in database
    for (const page of pages) {
      const { error } = await supabase
        .from('facebook_pages')
        .upsert([
          {
            user_id: userId,
            page_id: page.id,
            page_name: page.name,
            access_token: page.access_token,
            connected_at: new Date().toISOString()
          }
        ]);

      if (error) {
        console.error('Error storing page:', error);
      }

      // Subscribe to webhook for this page
      try {
        await axios.post(
          `https://graph.facebook.com/v18.0/${page.id}/subscribed_apps?access_token=${page.access_token}`,
          {
            subscribed_fields: 'messages,messaging_postbacks'
          }
        );
      } catch (webhookError) {
        console.error('Webhook subscription error:', webhookError.response?.data || webhookError.message);
      }
    }

    res.json({ 
      message: 'Facebook pages connected successfully',
      pages: pages.map(p => ({ id: p.id, name: p.name }))
    });
  } catch (error) {
    console.error('Facebook connection error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to connect Facebook account' });
  }
});

// Get connected pages
router.get('/pages', authenticateToken, async (req, res) => {
  try {
    const { data: pages, error } = await supabase
      .from('facebook_pages')
      .select('page_id, page_name, connected_at')
      .eq('user_id', req.user.id);

    if (error) {
      throw error;
    }

    res.json({ pages });
  } catch (error) {
    console.error('Get pages error:', error);
    res.status(500).json({ error: 'Failed to get pages' });
  }
});

// Disconnect Facebook page
router.delete('/disconnect/:pageId', authenticateToken, async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.user.id;

    // Get page access token before deleting
    const { data: page } = await supabase
      .from('facebook_pages')
      .select('access_token')
      .eq('page_id', pageId)
      .eq('user_id', userId)
      .single();

    if (page?.access_token) {
      // Unsubscribe from webhook
      try {
        await axios.delete(
          `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps?access_token=${page.access_token}`
        );
      } catch (webhookError) {
        console.error('Webhook unsubscription error:', webhookError.response?.data || webhookError.message);
      }
    }

    // Delete from database
    const { error } = await supabase
      .from('facebook_pages')
      .delete()
      .eq('page_id', pageId)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    res.json({ message: 'Page disconnected successfully' });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect page' });
  }
});

// Webhook verification
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
      console.log('Webhook verified');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Webhook endpoint for receiving messages
router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry) {
        const messaging = entry.messaging;
        if (messaging) {
          for (const event of messaging) {
            await handleIncomingMessage(event, entry.id);
          }
        }
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error processing webhook');
  }
});

// Handle incoming Facebook messages
async function handleIncomingMessage(event, pageId) {
  if (event.message) {
    const senderId = event.sender.id;
    const messageText = event.message.text;
    const timestamp = new Date(event.timestamp);

    // Check for existing conversation within 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    let { data: conversation } = await supabase
      .from('conversations')
      .select('*')
      .eq('page_id', pageId)
      .eq('customer_id', senderId)
      .gte('last_message_at', oneDayAgo.toISOString())
      .order('last_message_at', { ascending: false })
      .limit(1)
      .single();

    // Create new conversation if none exists or last message is older than 24h
    if (!conversation) {
      const { data: newConversation, error } = await supabase
        .from('conversations')
        .insert([
          {
            page_id: pageId,
            customer_id: senderId,
            customer_name: senderId, // Will be updated when we fetch user info
            created_at: timestamp.toISOString(),
            last_message_at: timestamp.toISOString()
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('Error creating conversation:', error);
        return;
      }

      conversation = newConversation;
    } else {
      // Update last message time
      await supabase
        .from('conversations')
        .update({ last_message_at: timestamp.toISOString() })
        .eq('id', conversation.id);
    }

    // Store the message
    await supabase
      .from('messages')
      .insert([
        {
          conversation_id: conversation.id,
          sender_id: senderId,
          message_text: messageText,
          is_from_customer: true,
          created_at: timestamp.toISOString()
        }
      ]);
  }
}

module.exports = router;