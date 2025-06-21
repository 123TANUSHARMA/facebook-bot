const express = require('express');
const axios = require('axios');
const { supabase } = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get conversations for user's pages
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    // Get user's pages first
    const { data: pages } = await supabase
      .from('facebook_pages')
      .select('page_id')
      .eq('user_id', req.user.id);

    if (!pages || pages.length === 0) {
      return res.json({ conversations: [] });
    }

    const pageIds = pages.map(p => p.page_id);

    // Get conversations for these pages
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        *,
        messages!inner(
          message_text,
          created_at,
          is_from_customer
        )
      `)
      .in('page_id', pageIds)
      .order('last_message_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Format conversations with last message
    const formattedConversations = conversations.map(conv => {
      const lastMessage = conv.messages
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      
      return {
        id: conv.id,
        customer_id: conv.customer_id,
        customer_name: conv.customer_name,
        page_id: conv.page_id,
        last_message: lastMessage?.message_text || '',
        last_message_time: conv.last_message_at,
        unread: true // You can implement read status later
      };
    });

    res.json({ conversations: formattedConversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

// Get messages for a specific conversation
router.get('/conversations/:conversationId/messages', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;

    // Verify user has access to this conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select(`
        *,
        facebook_pages!inner(user_id)
      `)
      .eq('id', conversationId)
      .single();

    if (!conversation || conversation.facebook_pages.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get messages
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    res.json({ 
      conversation,
      messages 
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send message to Facebook user
router.post('/conversations/:conversationId/reply', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get conversation and page details
    const { data: conversation } = await supabase
      .from('conversations')
      .select(`
        *,
        facebook_pages!inner(access_token, user_id)
      `)
      .eq('id', conversationId)
      .single();

    if (!conversation || conversation.facebook_pages.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const pageAccessToken = conversation.facebook_pages.access_token;

    // Send message to Facebook
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${pageAccessToken}`,
      {
        recipient: {
          id: conversation.customer_id
        },
        message: {
          text: message
        }
      }
    );

    // Store the message in database
    const { data: storedMessage, error } = await supabase
      .from('messages')
      .insert([
        {
          conversation_id: conversationId,
          sender_id: req.user.id,
          message_text: message,
          is_from_customer: false,
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Update conversation last message time
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    res.json({ 
      message: 'Message sent successfully',
      storedMessage 
    });
  } catch (error) {
    console.error('Send message error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

module.exports = router;