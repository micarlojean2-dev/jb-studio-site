import { sendReservationEmails } from '../lib/reservation-emails.js';

let sentMail = null;

const mockResend = {
  emails: {
    send: async (data) => {
      sentMail = data;
      return { id: 'msg_test_123' };
    }
  }
};

const client = {
  id: 'spa',
  businessName: 'Spa Armonía',
  color: '#3F6B5B',
  language: 'es',
  ownerEmail: 'dueno@spaarmonia.com'
};

const reservation = {
  clientId: 'spa',
  nombre: 'María Elena Torres',
  servicio: 'Masaje relajante',
  fecha: 'viernes 15 de agosto de 2026',
  hora: '16:00',
  telefono: '+56 9 8765 4321',
  email: 'maria.torres@example.com',
  specialRequests: 'Prefiero aceite de almendras y música suave.',
  language: 'es'
};

await sendReservationEmails(client, reservation, 'confirmed', { resend: mockResend });

console.log('=== CORREO GENERADO PARA EL DUEÑO ===\n');
console.log('Para:', sentMail?.to);
console.log('Asunto:', sentMail?.subject);
console.log('\nHTML Renderizado:\n');
console.log(sentMail?.html);
