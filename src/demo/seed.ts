import { useBoard } from '../store'
import type { CardType } from '../types'

/**
 * A believable messy pile: ~120 scraps from someone researching opening a
 * small specialty coffee bar. No structure, mixed registers, a few planted
 * near-duplicates, two videos for the Gemini handoff beat. Demo at 120-150
 * cards on purpose — force layouts hairball past ~200.
 */

const T: string[] = [
  // --- machines / equipment ---
  'Linea Mini vs GS3 — Mini is $6k, GS3 almost double. do we even need dual boiler for bar volume?',
  'used La Marzocco Linea 2-group on marketplace, $7,800, 2019, "light home use" (sure)',
  'grinder matters more than the machine. everyone says this. Mythos One or EK43 for filter',
  'EK43 retention is basically zero, good for singles. loud though',
  'Mahlkonig EK43 — the filter grinder. ~$3,500 new',
  'water: 40-80 ppm hardness target, chlorine kills espresso. need a proper filtration setup, BWT or 3M',
  'espresso machine needs 220V dedicated 30A circuit — check what the space has BEFORE signing',
  'Fetco batch brewer for volume mornings, dont hand-pour when there is a line',
  'undercounter dishwasher is not optional per health code (3-compartment sink debate)',
  'ice machine lead time is 6-8 weeks right now apparently',
  'Acaia scales for bar, 2x, they die if milk gets in the USB port',
  'puq press? $8k to not destroy baristas wrists. later maybe',
  'decent used Nuova Simonelli Appia for backup / catering rig, saw one for $2k',
  'need a water softener test kit before we commit to any machine warranty',
  // --- beans / sourcing / roasting ---
  'roast our own later. year one: guest roasters, rotate every 6 weeks',
  'talked to Sey — wholesale needs 20lb/wk minimum commitment',
  'local roaster co-op does profit share instead of wholesale pricing, interesting model',
  'Ethiopian naturals pull people in but need a safe washed Colombia on the menu always',
  'single origin espresso scares normies. do a house blend + rotating single',
  'decaf is 8-12% of orders now, sugarcane EA decaf actually tastes good',
  'green coffee prices up 40% yoy, C-market is brutal, lock contracts early',
  'freeze green? some shops freezing peak-crop lots to serve year round',
  'oatly barista vs minor figures vs local oat — cup side by side',
  'oat milk is now 60%+ of milk drinks at some shops. dairy is the alternative now',
  'ask roasters for spent-crop discount lots for cold brew, nobody can tell in cold brew',
  'cupping standards: SCA protocol, 8.25g per 150ml',
  'direct trade claims are mostly marketing unless you can name the producer',
  'kenyan AA prices insane this year, skip, do Rwanda instead — similar profile',
  // --- permits / regulation / legal ---
  'health permit: plan review takes 4-6 weeks in this county, submit floor plan FIRST',
  'food handler cards for every employee, manager needs ServSafe',
  'grease trap required?? we dont fry anything. answer: depends on menu, pastry warming ok',
  'ADA: 36 inch aisle minimums, counter section at 34 inches max height',
  'zoning is C-2 at the two spaces we like, coffee = "limited food service", should be fine',
  'sidewalk seating needs separate encroachment permit, $400/yr + insurance rider',
  'city requires 1 parking spot per 250 sqft?? variance possible for historic district',
  'sales tax on cold bottled drinks but not hot prepared?? ask the accountant',
  'LLC vs S-corp — start LLC, elect S-corp when payroll makes sense',
  'business insurance quotes: GL $1M + product liability, ~$180/mo',
  'music licensing! ASCAP/BMI will absolutely find you. Soundtrack your brand ~$35/mo covers it',
  'fire marshal: occupancy load calc decides if we need a second exit',
  'tip pooling rules changed 2024 — back of house can be included if no tip credit taken',
  'labor: 86 the unpaid trial shifts, they are illegal, pay for stage days',
  // --- space / interior / build ---
  'the Maple St space: 900 sqft, $38/sqft/yr NNN, south light all day, no hood',
  'the Depot space: 1400 sqft, old ticket window could BE the bar. $29/sqft but rough shell',
  'landlord TI allowance — push for $40/sqft minimum on the shell space',
  'exposed ceiling = echo box. budget acoustic panels early, loud cafes die on laptops',
  'concrete floors: seal them, dont tile, $4/sqft vs $12',
  'bar depth 30 inches workside, 12 inch customer ledge. flow drawing v3 in sketchbook',
  'window bar seating faces the street = free advertising, people watching people',
  'plumbing rough-in is THE renovation cost. keep bar near existing stack',
  'one big communal table anchors the room, vintage door on trestles?',
  'plants that survive espresso humidity: pothos, monstera, zz. no ficus drama',
  'lighting: 2700K everywhere, dimmable, NO downlights over seats, glare on laptops',
  'bathroom counts: under 30 seats = 1 unisex ok in this code',
  'salvage yard has old library card catalog cabinet — retail shelf?? on brand',
  'outlets at EVERY seat or the laptop people will colonize the two that exist',
  'garage door front? costs $9k but the open-air thing in summer is unbeatable',
  // --- pricing / finance ---
  'cappuccino price survey: $4.75-$5.50 downtown, $4.25 at the good place by campus',
  'espresso drinks ~18-22% COGS if beans under $14/lb wholesale',
  'food from partner bakery: 50/50 split or buy wholesale at 40% off retail?',
  'break-even sketch: rent 3800 + labor 14k + cogs — need ~$1,450/day avg. gulp',
  'average ticket $7.80 at comparable shops, push to $9 with pastry attach',
  'card fees 2.6% — cash discount programs feel scammy, skip',
  'startup budget v2: equipment 38k, buildout 60-90k?!, working capital 25k, permits 4k',
  'SBA 7a loan needs 10% down + personal guarantee. terrifying. alternatives?',
  'revenue based financing for cafes = predatory rates mostly, avoid',
  'the 3rd space thing means people camp 3 hours on a $5 latte. laptop policy??',
  'no laptops weekends after 11am? some shops do "no screens" zones instead',
  'loyalty: punch card is fine. app is overkill year one',
  'pre-paid house accounts — regulars load $100 get $110. instant cash flow',
  'catering carts at farmers market = revenue before doors even open??',
  'tip guilt screens annoy everyone. counter service default 15% max suggested',
  // --- marketing / community ---
  'name shortlist: Meridian, Houseplant Coffee, The Depot, Little Signal',
  'instagram before opening: build-out progress posts get insane engagement',
  'soft open for neighbors only, week before real open, work out the bugs',
  'latte art throwdown nights — baristas from other shops show up, instant community',
  'partner with the run club, 8am saturday finish line = 40 covers',
  'local paper still matters here, invite the food writer to soft open',
  'open mic night? noise permit needed after 9pm',
  'merch: hats > totes now apparently. small run, local printer',
  'google maps listing photos matter more than the website. hire photographer day one',
  'collab with the bookstore next door — coffee + used paperback bundle',
  'neighborhood fb group complains about everything. get ahead of parking complaints',
  'church crowd sunday = biggest volume day at comparable shop, staff accordingly',
  // --- staffing / operations ---
  'barista pay here: $16-18 + tips averaging $6-9/hr at busy shops',
  'need 2 on bar + 1 float weekend mornings, solo weekday afternoons ok',
  'training budget: 2 full paid weeks before open, dial-in is a skill',
  'opening checklist laminated by the machine — the 5:45am brain is not a brain',
  'closing takes 45 min minimum, schedule it, dont steal it from people',
  'hire for niceness, train for latte art, not the reverse',
  'one keyholder rule almost sank the place across town, cross-train everything',
  'schedule app: 7shifts vs sling, both ~$3/employee/mo',
  'burnout is the real cost center. 4-day weeks for FT bar staff?',
  'r&d hour friday afternoons — staff invent drinks, menu stays alive',
  // --- menu / drinks ---
  'menu: 6 espresso drinks MAX. decision fatigue is real at 7am',
  'seasonal special every 6 weeks, one, singular, resist the ladder',
  'matcha is 15% of revenue at comparable shops now?? need a good supplier',
  'chai from concentrate is sad. house-brewed masala chai as the sleeper hit',
  'drip should be $3 and excellent. its the trust drink',
  'kids menu = babycino + cookie. parents become regulars',
  'sparkling espresso tonic for summer, batch the tonic syrup',
  'cold brew tap keg lasts 10 days, nitro adds theater',
  'pastry case: 4 items from the bakery, sell out by 1pm on purpose',
  'oat + honey + espresso over ice = the tiktok drink, have a name ready',
  // --- misc scraps (stay loose) ---
  'that green tile from the hotel lobby in Lisbon — find who makes it',
  'grandpa’s diner ran 40 years on coffee and stubbornness, ask mom for photos',
  'dream: sunday morning, full room, nobody on a phone, rain outside',
  'the name should work spoken aloud in a drive-thru order. test everything that way',
  'what would this place smell like? bread + cardamom + rain',
  // --- planted near-duplicates ---
  'Mahlkonig EK43 grinder, about $3500 new — the standard for filter',
  'cappuccino prices downtown run $4.75 to $5.50',
  'health dept plan review takes 4 to 6 weeks here — floor plan goes in first',
  // --- links ---
  'https://sca.coffee/research/protocols-best-practices',
  'https://www.lamarzoccousa.com/products/linea-mini/',
  'https://pos.toasttab.com/blog/on-the-line/how-much-does-it-cost-to-open-a-coffee-shop',
]

const VIDEOS: Array<{ url: string; title: string }> = [
  { url: 'https://www.youtube.com/watch?v=klksLmn3kZk', title: 'cafe build-out walkthrough — need the numbers from this' },
  { url: 'https://www.youtube.com/watch?v=st571DYYTR8', title: 'dialing in espresso — training reference' },
]

export function seedDemo(): void {
  const store = useBoard.getState()
  const R = 780
  const rand = (r: number) => (Math.random() - 0.5) * 2 * r

  const items = [
    ...T.map((content) => ({
      content,
      type: (content.startsWith('http') ? 'link' : 'text') as CardType,
      at: { x: rand(R), y: rand(R * 0.62) },
    })),
    ...VIDEOS.map((v) => ({
      content: v.url,
      type: 'video' as CardType,
      title: v.title,
      at: { x: rand(R), y: rand(R * 0.62) },
    })),
  ]
  store.addCards(items, 'human')
  store.renameBoard('coffee bar research')
}
