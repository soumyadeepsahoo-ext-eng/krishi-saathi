import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n✗ Missing environment variable ${name}. Copy .env.example to .env and fill it in (see SETUP.md).\n`);
    process.exit(1);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT || 8080),
  anthropicKey: required('ANTHROPIC_API_KEY'),
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  fastModel: process.env.CLAUDE_FAST_MODEL || 'claude-haiku-5-5',
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  sarvamKey: process.env.SARVAM_API_KEY || '',           // optional: voice input + read-aloud
  adminToken: required('ADMIN_TOKEN'),                   // password for /admin
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean),
  botName: process.env.BOT_NAME || 'Krishi Saathi',
};
