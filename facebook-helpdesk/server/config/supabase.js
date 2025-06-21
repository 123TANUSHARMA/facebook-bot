const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Database schema setup functions
const setupDatabase = async () => {
  try {
    // Create users table
    await supabase.rpc('create_users_table', {});
    
    // Create facebook_pages table
    await supabase.rpc('create_facebook_pages_table', {});
    
    // Create conversations table
    await supabase.rpc('create_conversations_table', {});
    
    // Create messages table
    await supabase.rpc('create_messages_table', {});
    
    console.log('Database setup completed');
  } catch (error) {
    console.log('Database setup error (tables might already exist):', error.message);
  }
};

module.exports = { supabase, setupDatabase };