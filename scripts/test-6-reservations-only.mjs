const BASE_URL = 'https://jbstudio.app';
const CHAT_URL = `${BASE_URL}/api/client-chat?__bypass=test_bypass_secret_2026`;
const RESERVATIONS_URL = `${BASE_URL}/api/reservations?__bypass=test_bypass_secret_2026`;

const testCases = [
  {
    business: 'spa',
    clientId: 'spa',
    testNum: '#14 (EN)',
    prompt: 'Great, 11:30 AM works perfect for me, my name is John Doe, email johndoe.test.e2e@gmail.com, phone 5551234567',
    bookingData: {
      servicio: 'Masaje relajante',
      fecha: 'mañana',
      hora: '11:30 AM',
      nombre: 'John Doe',
      email: 'johndoe.test.e2e@gmail.com',
      telefono: '+15551234567'
    }
  },
  {
    business: 'spa',
    clientId: 'spa',
    testNum: '#44 (ES)',
    prompt: 'Me queda bien a las 2:00 PM, mi nombre es Ana García, email anagarcia.test.e2e@gmail.com',
    bookingData: {
      servicio: 'Facial hidratante',
      fecha: 'mañana',
      hora: '2:00 PM',
      nombre: 'Ana García',
      email: 'anagarcia.test.e2e@gmail.com',
      telefono: '+15559998877'
    }
  },
  {
    business: 'barberia-el-corte-fino',
    clientId: 'barberia-el-corte-fino',
    testNum: '#14 (ES)',
    prompt: 'Agendar a las 11:00 AM, mi nombre es Carlos Test, email carlostest.e2e@gmail.com',
    bookingData: {
      servicio: 'Corte de cabello',
      fecha: 'mañana',
      hora: '11:00 AM',
      nombre: 'Carlos Test',
      email: 'carlostest.e2e@gmail.com',
      telefono: '+15559876543'
    }
  },
  {
    business: 'barberia-el-corte-fino',
    clientId: 'barberia-el-corte-fino',
    testNum: '#44 (EN)',
    prompt: 'Book 11:00 AM, my name is Charles Test, email charlestest.e2e@gmail.com',
    bookingData: {
      servicio: 'Corte de cabello',
      fecha: 'mañana',
      hora: '11:00 AM',
      nombre: 'Charles Test',
      email: 'charlestest.e2e@gmail.com',
      telefono: '+15559876544'
    }
  },
  {
    business: 'restaurante-e2e-intenso',
    clientId: 'restaurante-e2e-intenso',
    testNum: '#14 (ES)',
    prompt: 'Agendar a las 2:00 PM para 2 personas, nombre Luis Test, email luistest.e2e@gmail.com',
    bookingData: {
      servicio: 'Mesa para 2 personas',
      fecha: 'mañana',
      hora: '2:00 PM',
      nombre: 'Luis Test',
      email: 'luistest.e2e@gmail.com',
      telefono: '+15551112233'
    }
  },
  {
    business: 'restaurante-e2e-intenso',
    clientId: 'restaurante-e2e-intenso',
    testNum: '#44 (EN)',
    prompt: 'Book 2:00 PM for 2 people, name Lewis Test, email lewistest.e2e@gmail.com',
    bookingData: {
      servicio: 'Mesa para 2 personas',
      fecha: 'mañana',
      hora: '2:00 PM',
      nombre: 'Lewis Test',
      email: 'lewistest.e2e@gmail.com',
      telefono: '+15551112234'
    }
  }
];

async function main() {
  console.log('🚀 Ejecutando SOLO las 6 pruebas de reserva con envío real de correos...\n');
  const results = [];

  for (const tc of testCases) {
    console.log(`Testing ${tc.business} (${tc.testNum})...`);

    // 1. Probar llamada al chat para confirmar respuesta 200 y no 429
    const chatRes = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: tc.clientId,
        messages: [{ role: 'user', content: tc.prompt }]
      })
    });

    const chatData = await chatRes.json();

    // 2. Crear la reserva real en backend para disparar Resend
    const resRes = await fetch(RESERVATIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: tc.clientId,
        action: 'create',
        __bypass: 'test_bypass_secret_2026',
        booking: tc.bookingData
      })
    });

    const resData = await resRes.json();
    const reservation = resData.reservation || {};

    results.push({
      business: tc.business,
      testNum: tc.testNum,
      chatStatus: chatRes.status,
      chatOk: chatRes.ok && !chatData.error,
      chatText: chatData.text || '',
      reservationOk: resData.ok === true,
      reservationId: reservation.id || 'N/A',
      clientEmail: tc.bookingData.email,
      clientEmailMessageId: reservation.clientEmailMessageId || 'N/A',
      ownerEmailMessageId: reservation.ownerEmailMessageId || 'N/A',
      emailSent: reservation.emailSent === true
    });

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n======================================================');
  console.log('📊 RESULTADOS DE LAS 6 PRUEBAS DE RESERVA Y CORREO:');
  console.log('======================================================\n');

  results.forEach((r, i) => {
    console.log(`[${i+1}] ${r.business} ${r.testNum}:`);
    console.log(`    Chat Status: ${r.chatStatus} (${r.chatOk ? 'PASÓ' : 'FALLÓ'})`);
    console.log(`    Reserva ID: ${r.reservationId}`);
    console.log(`    Resend Client Email MessageID (${r.clientEmail}): ${r.clientEmailMessageId}`);
    console.log(`    Resend Owner Email MessageID (mikestandlyjeanbaptiste@gmail.com): ${r.ownerEmailMessageId}`);
    console.log(`    Estado Envío Correos: ${r.emailSent ? '✅ EXITO' : '❌ ERROR'}\n`);
  });
}

main();
