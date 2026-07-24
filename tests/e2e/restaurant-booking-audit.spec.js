const { test, expect } = require('@playwright/test');

const BASE = process.env.LOCAL_AUDIT_URL || 'http://localhost:4173';
const es = { templateId: 'restaurant', language: 'es' };
const en = { templateId: 'restaurant', language: 'en' };

const cases = [
  ['ES-01','es','sin queso','remove','cheese'],['ES-02','es','sin keso','remove','cheese'],['ES-03','es','sin qeso','remove','cheese'],['ES-04','es','sin seboya','remove','onions'],
  ['ES-05','es','sin cebolla y salsa aparte','remove','onions'],['ES-06','es','extra tocino','extra','bacon'],['ES-07','es','doble carne','extra','meat'],['ES-08','es','bien cocida','cooking','well_done'],
  ['ES-09','es','término medio','cooking','medium_rare'],['ES-10','es','poco picante','spice','no_spice'],['ES-11','es','mucho picante','spice','extra_spicy'],['ES-12','es','no me gusta el queso','remove','cheese'],
  ['ES-13','es','salsa apartee','notes','sauce_on_side'],['ES-14','es','poquita salsa','notes','light_sauce'],['ES-15','es','cambiar papas por ensalada','notes','swap_fries_salad'],['ES-16','es','sin tomate','remove','tomatoes'],
  ['ES-17','es','sin pepinillos','remove','pickles'],['ES-18','es','sin hielo','remove','ice'],
  ['EN-01','en','without cheese','remove','cheese'],['EN-02','en','without onions','remove','onions'],['EN-03','en','sauce on the side','notes','sauce_on_side'],['EN-04','en','extra bacon','extra','bacon'],
  ['EN-05','en','extra sauce','extra','sauce'],['EN-06','en','light sauce','notes','light_sauce'],['EN-07','en','well done','cooking','well_done'],['EN-08','en','medium rare','cooking','medium_rare'],
  ['EN-09','en','less spicy','spice','no_spice'],['EN-10','en','extra spicy','spice','extra_spicy'],['EN-11','en',"I don't like cheese",'remove','cheese'],['EN-12','en','no tomatoes','remove','tomatoes'],
  ['EN-13','en','no pickles','remove','pickles'],['EN-14','en','no mayo','remove','mayo'],['EN-15','en','no ketchup','remove','ketchup'],['EN-16','en','no ice','remove','ice'],
  ['EN-17','en','could I get it without onions','remove','onions'],['EN-18','en','add onions back','add','onions'],
  ['MX-01','es','extra queso','extra','cheese'],['MX-02','es','con cebolla','add','onions'],['MX-03','en','add cheese back','add','cheese'],['MX-04','en','double meat','extra','meat'],
];

for (const [id, lang, message, field, expected] of cases) {
  test(`${id} ${message}`, async ({ page }) => {
    await page.goto(`${BASE}/asistente.html?id=audit-${id}`);
    const result = await page.evaluate(({ message, cfg }) => {
      return window.JBChatCore.applyFoodPreferences(null, message, cfg);
    }, { message, cfg: lang === 'en' ? en : es });
    expect(result).not.toBeNull();
    expect(result[field]).toContain(expected);
  });
}

test('MED-01 Spanish allergy warning trigger', async ({ page }) => { await page.goto(`${BASE}/asistente.html?id=medical-es`); expect(await page.evaluate(() => window.JBChatCore.isFoodMedical('Soy alérgico al queso', {templateId:'restaurant'}))).toBeTruthy(); });
test('MED-02 Spanish intolerance warning trigger', async ({ page }) => { await page.goto(`${BASE}/asistente.html?id=medical-es-2`); expect(await page.evaluate(() => window.JBChatCore.isFoodMedical('Soy intolerante a la lactosa', {templateId:'restaurant'}))).toBeTruthy(); });
test('MED-03 Spanish celiac warning trigger', async ({ page }) => { await page.goto(`${BASE}/asistente.html?id=medical-es-3`); expect(await page.evaluate(() => window.JBChatCore.isFoodMedical('Soy celíaco', {templateId:'restaurant'}))).toBeTruthy(); });
test('MED-04 English allergy warning trigger', async ({ page }) => { await page.goto(`${BASE}/asistente.html?id=medical-en`); expect(await page.evaluate(() => window.JBChatCore.isFoodMedical("I'm allergic to dairy", {templateId:'restaurant'}))).toBeTruthy(); });
test('MED-05 English intolerance warning trigger', async ({ page }) => { await page.goto(`${BASE}/asistente.html?id=medical-en-2`); expect(await page.evaluate(() => window.JBChatCore.isFoodMedical("I'm lactose intolerant", {templateId:'restaurant'}))).toBeTruthy(); });
test('MED-06 English celiac warning trigger', async ({ page }) => { await page.goto(`${BASE}/asistente.html?id=medical-en-3`); expect(await page.evaluate(() => window.JBChatCore.isFoodMedical('I have celiac disease', {templateId:'restaurant'}))).toBeTruthy(); });

for (const [id, first, second, field, final] of [
  ['CH-01','extra queso','sin queso','remove','cheese'],['CH-02','sin queso','con queso','add','cheese'],['CH-03','sin cebolla','con cebolla','add','onions'],
  ['CH-04','extra salsa','poquita salsa','notes','light_sauce'],['CH-05','mucho picante','poco picante','spice','no_spice'],['CH-06','bien cocida','término medio','cooking','medium_rare'],
  ['CH-07','extra cheese','no cheese','remove','cheese'],['CH-08','no onions','add onions back','add','onions'],
]) test(`${id} latest decision wins`, async ({ page }) => { await page.goto(`${BASE}/asistente.html?id=${id}`); const value=await page.evaluate(({first,second})=>{let x=window.JBChatCore.applyFoodPreferences(null,first,{templateId:'restaurant'});return window.JBChatCore.applyFoodPreferences(x,second,{templateId:'restaurant'});},{first,second}); expect(value[field]).toContain(final); });

for (const [id, text, service] of [['DISH-01','cambiar hamburguesa por pizza','Pizza'],['DISH-02','change burger to pizza','Pizza']]) test(`${id} last dish wins`, async ({page})=>{await page.goto(`${BASE}/asistente.html?id=${id}`);const x=await page.evaluate(({text})=>window.JBChatCore.extractBooking(text,[{nombre:'Hamburguesa'},{nombre:'Pizza'},{nombre:'burger'}],null,'es',{templateId:'restaurant'}),{text});expect(x.servicio).toBe(service);});

for (const [id, lang] of [['PERSIST-01','es'],['PERSIST-02','en']]) test(`${id} session state survives reload`, async ({ page }) => {
  await page.goto(`${BASE}/asistente.html?id=${id}`);
  await page.evaluate(({ lang }) => sessionStorage.setItem(`jba_${location.search.slice(4)}_booking`, JSON.stringify({bookingStep:1,bookingData:{servicio:lang==='en'?'Classic Burger':'Hamburguesa Clásica',personas:'2',fecha:'2026-08-05',hora:'1:00 PM',specialRequests:lang==='en'?'No cheese':'Sin queso',foodPreferences:{remove:['cheese'],add:[],extra:[],cooking:'',spice:'',notes:[]}},bookingPending:null,bookingReview:false,language:lang})), { lang });
  await page.reload();
  const saved = await page.evaluate(() => sessionStorage.getItem(Object.keys(sessionStorage).find(k => k.endsWith('_booking'))));
  expect(saved).toContain('cheese');
});

for (const [id, lang, dish, special] of [['PERSIST-03','es','Hamburguesa Clásica','Sin queso'],['PERSIST-04','en','Classic Burger','No cheese'],['PERSIST-05','es','Pizza','Salsa aparte']]) test(`${id} saved booking fields survive reload`, async ({ page }) => {
  await page.goto(`${BASE}/asistente.html?id=${id}`);
  await page.evaluate(({ lang, dish, special }) => sessionStorage.setItem(`jba_${location.search.slice(4)}_booking`, JSON.stringify({bookingStep:1,bookingData:{servicio:dish,personas:'2',fecha:'2026-08-05',hora:'1:00 PM',nombre:'QA',telefono:'5551234567',email:'qa@example.com',specialRequests:special,foodPreferences:{remove:['cheese'],add:[],extra:[],cooking:'',spice:'',notes:[]}},bookingPending:null,bookingReview:true,language:lang})), {lang,dish,special});
  await page.reload();
  const restored = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.endsWith('_booking')))).bookingData);
  expect(restored).toMatchObject({servicio:dish,personas:'2',hora:'1:00 PM',specialRequests:special,telefono:'5551234567'});
});

for (const [id, lang, messages] of [['LONG-01','es',45],['LONG-02','en',46],['LONG-03','mixed',47]]) test(`${id} retains a long booking conversation`, async ({ page }) => {
  await page.goto(`${BASE}/asistente.html?id=${id}`);
  const state = await page.evaluate(({ messages }) => {
    const history = Array.from({length:messages}, (_,i)=>({role:i%2?'assistant':'user',content:`message ${i} about the reservation`}));
    const data = {servicio:'Classic Burger',personas:'2',fecha:'2026-08-05',hora:'2:00 PM',nombre:'QA',telefono:'5551234567',email:'qa@example.com',specialRequests:'No cheese',foodPreferences:{remove:['cheese'],add:[],extra:[],cooking:'',spice:'',notes:[]}};
    sessionStorage.setItem('long-audit',JSON.stringify(history));
    return { history: JSON.parse(sessionStorage.getItem('long-audit')).length, data };
  }, {messages});
  expect(state.history).toBeGreaterThan(40);
  expect(state.data).toMatchObject({servicio:'Classic Burger',specialRequests:'No cheese',hora:'2:00 PM'});
});

for (const [id, text, expected] of [['BI-01','Quiero una hamburguesa without cheese','cheese'],['BI-02','I want una pizza sin queso','cheese']]) test(`${id} bilingual preference remains normalized`, async ({ page }) => {
  await page.goto(`${BASE}/asistente.html?id=${id}`);
  const result = await page.evaluate(text => window.JBChatCore.applyFoodPreferences(null,text,{templateId:'restaurant'}), text);
  expect(result.remove).toContain(expected);
});
