import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

export const supabase = createClient(
  'https://fawtkejqwypmjcephtdj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhd3RrZWpxd3lwbWpjZXBodGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTgxMDYsImV4cCI6MjEwMjkzNDEwNn0.CK5xgyAlAE1jRGpRCj3BXmnsGQ9HOsSTjdOot0kInx4',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

// Informações institucionais editáveis — não armazene segredos neste arquivo.
export const EVENT_CONFIG = {
  pixKey: 'CHAVE PIX A CONFIGURAR',
  pixHolder: 'Escola — a configurar',
  pixBank: 'Banco — a configurar',
  pixQrImage: '',
  whatsappNumber: '',
};
