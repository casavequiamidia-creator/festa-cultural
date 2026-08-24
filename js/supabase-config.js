import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

export const supabase = createClient(
  'https://fawtkejqwypmjcephtdj.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhd3RrZWpxd3lwbWpjZXBodGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTgxMDYsImV4cCI6MjEwMjkzNDEwNn0.CK5xgyAlAE1jRGpRCj3BXmnsGQ9HOsSTjdOot0kInx4',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

// Informações institucionais editáveis — não armazene segredos neste arquivo.
// DADOS FICTÍCIOS de demonstração: troque pelos dados reais da escola.
export const EVENT_CONFIG = {
  pixKey: 'pix-festa@escolaexemplo.com',
  pixHolder: 'APM — Escola Exemplo (fictício)',
  pixBank: 'Banco Exemplo S.A. (fictício)',
  pixQrImage: '',
  whatsappNumber: '5511900000000', // fictício: troque pelo WhatsApp real da organização
};
